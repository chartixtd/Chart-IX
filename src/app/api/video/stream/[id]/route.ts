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
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
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

  // 5. Get Content-Type from upstream (HEAD or first chunk)
  let upstreamContentType = "video/mp4";

  // 6. Handle Range requests from browser
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const rangeStart = parseInt(match[1]);
      const rangeEndRaw = match[2];
      const requestedEnd = rangeEndRaw ? parseInt(rangeEndRaw) : (maxBytes > 0 ? maxBytes - 1 : rangeStart + 1024 * 1024 - 1);

      // Free preview: reject ranges past the limit
      if (isFreePreview && rangeStart >= maxBytes) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${maxBytes}` },
        });
      }

      const cappedEnd = isFreePreview ? Math.min(requestedEnd, maxBytes - 1) : requestedEnd;

      // Get content type from a small initial range if needed
      if (upstreamContentType === "video/mp4") {
        const headRes = await fetch(signedUrl, {
          headers: { Range: `bytes=0-0` },
        });
        upstreamContentType = headRes.headers.get("Content-Type") ?? "video/mp4";
      }

      const effectiveTotal = isFreePreview ? maxBytes : fullSize;
      return proxyRange(signedUrl, rangeStart, cappedEnd, effectiveTotal, upstreamContentType);
    }
  }

  // 7. No Range header → serve initial chunk
  // Get content type
  const headRes = await fetch(signedUrl, {
    headers: { Range: `bytes=0-0` },
  });
  upstreamContentType = headRes.headers.get("Content-Type") ?? "video/mp4";

  // Determine how much to serve
  const serveEnd = isFreePreview ? maxBytes - 1 : Math.min(fullSize - 1, 10 * 1024 * 1024 - 1); // Pro: first 10MB initial
  const effectiveTotal = isFreePreview ? maxBytes : fullSize;

  return proxyRange(signedUrl, 0, serveEnd, effectiveTotal, upstreamContentType);
}
