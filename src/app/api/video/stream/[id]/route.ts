import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

/** Extract the storage file path from a Supabase public URL */
function getStoragePath(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    const bucketIndex = parts.indexOf("videos");
    if (bucketIndex === -1) return null;
    return parts.slice(bucketIndex + 1).join("/");
  } catch {
    return null;
  }
}

const EXT_CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  ogg: "video/ogg",
};

/** Guess content type from the file extension so we don't need an extra
 *  upstream round-trip just to read the Content-Type header. */
function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CONTENT_TYPES[ext] ?? "video/mp4";
}

/** Proxy a range request to Supabase and return the response */
async function proxyRange(
  signedUrl: string,
  rangeStart: number,
  rangeEnd: number,
  totalSize: number,
  upstreamContentType: string
) {
  const upstreamRes = await fetch(signedUrl, {
    headers: { Range: `bytes=${rangeStart}-${rangeEnd}` },
  });

  const body = upstreamRes.body;
  const actualLength = parseInt(upstreamRes.headers.get("Content-Length") ?? "0");

  const headers = new Headers();
  headers.set("Content-Type", upstreamContentType);
  headers.set("Content-Range", `bytes ${rangeStart}-${rangeStart + actualLength - 1}/${totalSize}`);
  headers.set("Content-Length", String(actualLength));
  headers.set("Accept-Ranges", "bytes");
  // Truncated preview bytes are identical for every free-tier viewer of this
  // video, so let the browser reuse them across seeks within one session
  // instead of re-fetching the same range from our server every time.
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");

  return new NextResponse(body, { status: 206, headers });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const serviceClient = createServiceRoleClient();

  // 1. Get video metadata
  const { data: video, error: videoError } = await serviceClient
    .from("videos")
    .select("storage_url, file_size_bytes, duration_seconds, tier_required")
    .eq("id", id)
    .eq("is_deleted", false)
    .single();

  if (videoError || !video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const storagePath = getStoragePath(video.storage_url);
  if (!storagePath) {
    return NextResponse.json({ error: "Invalid storage URL" }, { status: 500 });
  }

  // 2. Determine user tier
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;

  let isPro = false;
  if (userId) {
    const { data: profile } = await serviceClient
      .from("users")
      .select("tier")
      .eq("id", userId)
      .single();
    isPro = profile?.tier === "pro";
  }

  const isFreePreview = !isPro && video.tier_required === "pro";

  // 3. Calculate size limit
  const fullSize = video.file_size_bytes ?? 0;
  const maxBytes = isFreePreview
    ? (fullSize > 0 && video.duration_seconds > 0
        ? Math.ceil((fullSize / video.duration_seconds) * 70) // 60s + buffer
        : 50 * 1024 * 1024) // fallback: 50MB
    : fullSize;

  // 4. Generate signed URL to fetch from Supabase
  const { data: signedData, error: signedErr } = await serviceClient.storage
    .from("videos")
    .createSignedUrl(storagePath, 300); // 5 min

  if (signedErr || !signedData?.signedUrl) {
    return NextResponse.json({ error: "Failed to generate URL" }, { status: 500 });
  }

  const signedUrl = signedData.signedUrl;

  // 5. Full access (not a capped free preview): no byte-range enforcement
  // needed, so redirect straight to Supabase's storage CDN instead of
  // proxying every byte through our own server. This was the main cause of
  // slow playback — every chunk previously made two upstream fetches (one
  // just to read Content-Type, one for the actual bytes) and then streamed
  // through our server as a second hop before reaching the browser.
  if (!isFreePreview) {
    return NextResponse.redirect(signedUrl, { status: 302 });
  }

  const upstreamContentType = guessContentType(storagePath);

  // 6. Free preview: proxy so we can cap the served byte range
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const rangeStart = parseInt(match[1]);
      const rangeEndRaw = match[2];
      const requestedEnd = rangeEndRaw ? parseInt(rangeEndRaw) : maxBytes - 1;

      if (rangeStart >= maxBytes) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${maxBytes}` },
        });
      }

      const cappedEnd = Math.min(requestedEnd, maxBytes - 1);
      return proxyRange(signedUrl, rangeStart, cappedEnd, maxBytes, upstreamContentType);
    }
  }

  // 7. No Range header → serve initial capped chunk
  return proxyRange(signedUrl, 0, maxBytes - 1, maxBytes, upstreamContentType);
}
