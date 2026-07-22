import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

/** Extract the storage file path from a Supabase public URL */
function getStoragePath(url: string): string | null {
  try {
    const u = new URL(url);
    // URL format: /storage/v1/object/public/videos/<path>
    const parts = u.pathname.split("/");
    const bucketIndex = parts.indexOf("videos");
    if (bucketIndex === -1) return null;
    return parts.slice(bucketIndex + 1).join("/");
  } catch {
    return null;
  }
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

  // 3. Pro user or free video → redirect to signed URL (no Vercel bandwidth cost)
  if (isPro || video.tier_required === "free") {
    const { data: signedData, error: signedErr } = await serviceClient.storage
      .from("videos")
      .createSignedUrl(storagePath, 86400); // 24 hours

    if (signedErr || !signedData?.signedUrl) {
      return NextResponse.json({ error: "Failed to generate URL" }, { status: 500 });
    }

    return NextResponse.redirect(signedData.signedUrl);
  }

  // 4. Free user + pro video → proxy with byte limit to prevent full download
  // Calculate max bytes for ~70 seconds (60s preview + buffer for VBR)
  const maxBytes = video.file_size_bytes && video.duration_seconds > 0
    ? Math.ceil((video.file_size_bytes / video.duration_seconds) * 70)
    : 50 * 1024 * 1024; // fallback: 50MB

  // Generate signed URL to fetch from Supabase
  const { data: signedData, error: signedErr } = await serviceClient.storage
    .from("videos")
    .createSignedUrl(storagePath, 300); // 5 minutes for server-side fetch

  if (signedErr || !signedData?.signedUrl) {
    return NextResponse.json({ error: "Failed to generate URL" }, { status: 500 });
  }

  // 5. Handle Range requests from HTML5 video player
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const rangeStart = parseInt(match[1]);
      const rangeEndRaw = match[2];
      const rangeEnd = rangeEndRaw ? parseInt(rangeEndRaw) : rangeStart + maxBytes - 1;

      if (rangeStart >= maxBytes) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${maxBytes}` } });
      }

      const cappedEnd = Math.min(rangeEnd, maxBytes - 1);
      const fetchHeaders: Record<string, string> = {
        Range: `bytes=${rangeStart}-${cappedEnd}`,
      };

      const upstreamRes = await fetch(signedData.signedUrl, { headers: fetchHeaders });
      if (!upstreamRes.ok && upstreamRes.status !== 206) {
        return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
      }

      const headers = new Headers();
      headers.set("Content-Type", upstreamRes.headers.get("Content-Type") ?? "video/mp4");
      headers.set("Content-Range", `bytes ${rangeStart}-${cappedEnd}/${maxBytes}`);
      headers.set("Content-Length", String(cappedEnd - rangeStart + 1));
      headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", "no-store");

      return new NextResponse(upstreamRes.body, { status: 206, headers });
    }
  }

  // 6. No Range header → cap initial fetch to maxBytes
  const upstreamRes = await fetch(signedData.signedUrl, {
    headers: { Range: `bytes=0-${maxBytes - 1}` },
  });

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", upstreamRes.headers.get("Content-Type") ?? "video/mp4");
  headers.set("Content-Range", `bytes 0-${Math.min(maxBytes - 1, parseInt(upstreamRes.headers.get("Content-Length") ?? "0") - 1)}/${maxBytes}`);
  headers.set("Content-Length", upstreamRes.headers.get("Content-Length") ?? String(maxBytes));
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "no-store");

  return new NextResponse(upstreamRes.body, { status: 206, headers });
}
