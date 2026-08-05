import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getUserTier } from "@/lib/supabase/get-user-tier";

// ---------------------------------------------------------------------------
// POST /api/community/upload — cover image upload for community posts.
// Same shape as /api/admin/upload but gated on Pro tier instead of admin
// role, and writes into its own "community-posts" bucket so a regular Pro
// member's uploads never land in the admin-only "articles" media library.
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB — smaller than the admin article limit, this is a forum post cover, not a hero banner

function uniqueFilename(original: string): string {
  const ext = original.includes(".") ? original.slice(original.lastIndexOf(".")) : "";
  const base = original.includes(".") ? original.slice(0, original.lastIndexOf(".")) : original;
  const safe = base.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 60);
  return `${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tier = await getUserTier(userId);
    if (tier !== "pro") {
      return NextResponse.json({ error: "pro_required" }, { status: 403 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Request must be multipart/form-data with a 'file' field" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "A 'file' field is required" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds maximum size of 5 MB" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `File type '${file.type}' is not allowed. Accepted: ${ALLOWED_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const client = createServiceRoleClient();
    const bucketName = "community-posts";

    const { data: buckets } = await client.storage.listBuckets();
    if (!buckets?.some((b) => b.name === bucketName)) {
      const { error: createErr } = await client.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: MAX_SIZE,
        allowedMimeTypes: ALLOWED_TYPES,
      });
      if (createErr) {
        return NextResponse.json({ error: `Failed to create storage bucket: ${createErr.message}` }, { status: 500 });
      }
    }

    const filename = `${userId}/${uniqueFilename(file.name)}`;
    const buffer = new Uint8Array(await file.arrayBuffer());

    const { error: uploadErr } = await client.storage
      .from(bucketName)
      .upload(filename, buffer, { contentType: file.type, upsert: false });

    if (uploadErr) {
      return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
    }

    const { data: { publicUrl } } = client.storage.from(bucketName).getPublicUrl(filename);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
