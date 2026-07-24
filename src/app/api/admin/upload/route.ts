import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { requireAdmin } from "@/lib/supabase/admin-auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Allowed image MIME types */
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

/** Maximum file size: 10 MB */
const MAX_SIZE = 10 * 1024 * 1024;

/** Generate a unique filename to avoid collisions */
function uniqueFilename(original: string): string {
  const ext = original.includes(".") ? original.slice(original.lastIndexOf(".")) : "";
  const base = original.includes(".")
    ? original.slice(0, original.lastIndexOf("."))
    : original;
  const safe = base
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60);
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `${safe}-${ts}-${rand}${ext}`;
}

// ---------------------------------------------------------------------------
// POST /api/admin/upload
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // --- Auth check ---

    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    // --- Parse FormData ---

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Request must be multipart/form-data with a 'file' field" },
        { status: 400 }
      );
    }

    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "A 'file' field is required" },
        { status: 400 }
      );
    }

    // --- Validate file ---

    if (file.size === 0) {
      return NextResponse.json(
        { error: "File is empty" },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File exceeds maximum size of 10 MB" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `File type '${file.type}' is not allowed. Accepted: ${ALLOWED_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // --- Upload to Supabase Storage ---

    const client = createServiceRoleClient();
    const filename = uniqueFilename(file.name);
    const bucketName = "articles";

    // Ensure the bucket exists (create if not)
    const { data: buckets } = await client.storage.listBuckets();
    const bucketExists = buckets?.some((b) => b.name === bucketName);

    if (!bucketExists) {
      const { error: createErr } = await client.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: MAX_SIZE,
        allowedMimeTypes: ALLOWED_TYPES,
      });

      if (createErr) {
        return NextResponse.json(
          { error: `Failed to create storage bucket: ${createErr.message}` },
          { status: 500 }
        );
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error: uploadErr } = await client.storage
      .from(bucketName)
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadErr.message}` },
        { status: 500 }
      );
    }

    // --- Get public URL ---

    const {
      data: { publicUrl },
    } = client.storage.from(bucketName).getPublicUrl(filename);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
