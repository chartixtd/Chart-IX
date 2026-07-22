"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { createClient } from "@/lib/supabase/client";
import { maskApiKey } from "@/lib/utils";

interface ApiKeyRow {
  id: string;
  label: string;
  is_valid: boolean;
  last_verified_at: string | null;
  created_at: string;
}

export default function ApiKeysPage() {
  const t = useTranslations("api_keys");
  const tCommon = useTranslations("common");
  const tError = useTranslations("error");
  const locale = useLocale();

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [newLabel, setNewLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const supabase = createClient();

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError(tError("unauthorized"));
      setLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("api_keys")
      .select("id, label, is_valid, last_verified_at, created_at")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setKeys(data || []);
    }
    setLoading(false);
  }, [supabase, tError]);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleAddKey = async () => {
    setFormError(null);

    if (!newLabel.trim()) { setFormError(t("label_placeholder")); return; }
    if (!newApiKey.trim()) { setFormError(t("api_key_placeholder")); return; }
    if (!newSecret.trim()) { setFormError(t("secret_placeholder")); return; }

    setSaving(true);

    try {
      const res = await fetch("/api/user/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newLabel.trim(),
          apiKey: newApiKey.trim(),
          secret: newSecret.trim(),
        }),
      });

      const json = await res.json();

      if (!json.success) {
        setFormError(json.error?.message || tError("unknown"));
        setSaving(false);
        return;
      }

      setSaving(false);
      setShowAddModal(false);
      setNewLabel("");
      setNewApiKey("");
      setNewSecret("");
      fetchKeys();
    } catch {
      setFormError(tError("network"));
      setSaving(false);
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    setDeleting(true);
    try {
      await fetch(`/api/user/api-keys?id=${keyId}`, { method: "DELETE" });
    } catch { /* ignore */ }
    setDeleting(false);
    setShowDeleteConfirm(null);
    fetchKeys();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="flex items-center justify-center py-24">
          <Spinner className="h-8 w-8" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t("title")}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t("description")}</p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>{t("add_key")}</Button>
      </div>

      {error && (
        <div className="mt-4 rounded-sm border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      <div className="mt-6 space-y-3">
        {keys.length === 0 ? (
          <EmptyState
            title={t("no_keys")}
            description={t("no_keys_desc")}
            action={<Button onClick={() => setShowAddModal(true)}>{t("add_key")}</Button>}
          />
        ) : (
          keys.map((key) => (
            <Card key={key.id} padding="md">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-text-primary truncate">{key.label}</h3>
                    <Badge variant={key.is_valid ? "green" : "red"} size="sm">
                      {key.is_valid ? t("verified") : t("invalid")}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-mono text-text-secondary">{maskApiKey("encrypted")}</p>
                    <p className="text-xs text-text-muted">
                      {t("added")}: {formatDate(key.created_at)}
                      {key.last_verified_at && ` · ${t("verified")}: ${formatDate(key.last_verified_at)}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  loading={deleting && showDeleteConfirm === key.id}
                  onClick={() => setShowDeleteConfirm(key.id)}
                >
                  {t("delete_key")}
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Add Key Modal */}
      <Modal
        open={showAddModal}
        onClose={() => { setShowAddModal(false); setFormError(null); setNewLabel(""); setNewApiKey(""); setNewSecret(""); }}
        title={t("add_key")}
      >
        <div className="space-y-4">
          <p className="text-xs text-text-muted">
            Your API key will be encrypted before storage and automatically verified against BingX.
          </p>
          <Input
            id="label"
            label={t("label")}
            placeholder={t("label_placeholder")}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            required
          />
          <Input
            id="apiKey"
            label={t("api_key_input")}
            placeholder={t("api_key_placeholder")}
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            required
          />
          <Input
            id="secret"
            type="password"
            label={t("secret_input")}
            placeholder={t("secret_placeholder")}
            hint={t("secret_help")}
            value={newSecret}
            onChange={(e) => setNewSecret(e.target.value)}
            required
          />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setShowAddModal(false); setFormError(null); setNewLabel(""); setNewApiKey(""); setNewSecret(""); }}>
              {tCommon("cancel")}
            </Button>
            <Button loading={saving} onClick={handleAddKey}>
              {saving ? t("verify") + "..." : t("save_key")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!showDeleteConfirm} onClose={() => setShowDeleteConfirm(null)} title={t("delete_key")} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">{t("delete_confirm")}</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(null)}>{tCommon("cancel")}</Button>
            <Button variant="danger" loading={deleting} onClick={() => showDeleteConfirm && handleDeleteKey(showDeleteConfirm)}>
              {tCommon("delete")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
