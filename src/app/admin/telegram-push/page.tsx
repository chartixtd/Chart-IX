import { getTelegramPushSettings, listTelegramTargets } from "@/lib/telegram-push";
import { TelegramPushEditor } from "./TelegramPushEditor";
import { AdminPageHeading } from "../AdminPageHeading";

export const dynamic = "force-dynamic";

export default async function AdminTelegramPushPage() {
  let error: string | null = null;
  let settings = null;
  let targets = null;

  try {
    const [raw, rawTargets] = await Promise.all([getTelegramPushSettings(), listTelegramTargets()]);
    // Strip the decrypted tokens before anything crosses to the client.
    const { botToken, ...rest } = raw;
    settings = { ...rest, botTokenConfigured: Boolean(botToken) };
    targets = rawTargets.map(({ botToken: _t, ...t }) => t);
  } catch (err) {
    console.error("[admin/telegram-push page]", err);
    error = "Failed to load Telegram push settings";
  }

  return (
    <div>
      <AdminPageHeading
        titleKey="telegram_push_list.title"
        resource="telegram push settings"
        errorMessage={error ?? undefined}
      />
      {!error && settings && targets && (
        <TelegramPushEditor initialSettings={settings} initialTargets={targets} />
      )}
    </div>
  );
}
