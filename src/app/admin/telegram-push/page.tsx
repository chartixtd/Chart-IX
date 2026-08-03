import { getTelegramPushSettings } from "@/lib/telegram-push";
import { TelegramPushEditor } from "./TelegramPushEditor";
import { AdminPageHeading } from "../AdminPageHeading";

export const dynamic = "force-dynamic";

export default async function AdminTelegramPushPage() {
  let error: string | null = null;
  let settings = null;

  try {
    const raw = await getTelegramPushSettings();
    const { botToken, ...rest } = raw;
    settings = { ...rest, botTokenConfigured: Boolean(botToken) };
  } catch (err) {
    error = String(err);
  }

  return (
    <div>
      <AdminPageHeading titleKey="telegram_push_list.title" resource="telegram push settings" errorMessage={error ?? undefined} />
      {!error && settings && <TelegramPushEditor initial={settings} />}
    </div>
  );
}
