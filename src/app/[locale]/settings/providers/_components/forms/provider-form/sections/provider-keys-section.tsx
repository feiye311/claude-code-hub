"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ProviderKey {
  id: number;
  providerId: number;
  key: string;
  name: string | null;
  weight: number;
  isEnabled: boolean;
  circuit: {
    state: "closed" | "open" | "half-open";
    failures: number;
    until?: number;
  };
  createdAt: string | null;
  updatedAt: string | null;
}

interface ProviderKeysSectionProps {
  providerId?: number;
  mode: "create" | "edit" | "batch";
}

function CircuitBadge({ state }: { state: ProviderKey["circuit"]["state"] }) {
  const t = useTranslations("settings.providers.form.keys");
  const variants: Record<string, string> = {
    closed: "bg-green-100 text-green-800",
    open: "bg-red-100 text-red-800",
    "half-open": "bg-yellow-100 text-yellow-800",
  };
  return (
    <Badge className={variants[state] ?? "bg-gray-100"}>
      {t(`circuit.${state}`)}
    </Badge>
  );
}

export function ProviderKeysSection({ providerId, mode }: ProviderKeysSectionProps) {
  const t = useTranslations("settings.providers.form.keys");
  const queryClient = useQueryClient();
  const isEdit = mode === "edit";

  const [newKey, setNewKey] = useState("");
  const [newWeight, setNewWeight] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["provider-keys", providerId],
    enabled: isEdit && !!providerId,
    queryFn: async () => {
      const res = await fetch(`/api/v1/providers/${providerId}/keys`);
      if (!res.ok) throw new Error("Failed to fetch provider keys");
      const json = await res.json();
      return json.items as ProviderKey[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: { key: string; weight: number }) => {
      const res = await fetch(`/api/v1/providers/${providerId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create key");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-keys", providerId] });
      setNewKey("");
      setNewWeight(1);
      toast.success(t("createSuccess"));
    },
    onError: () => toast.error(t("createError")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (keyId: number) => {
      const res = await fetch(`/api/v1/providers/${providerId}/keys/${keyId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete key");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-keys", providerId] });
      toast.success(t("deleteSuccess"));
    },
    onError: () => toast.error(t("deleteError")),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ keyId, isEnabled }: { keyId: number; isEnabled: boolean }) => {
      const res = await fetch(`/api/v1/providers/${providerId}/keys/${keyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled }),
      });
      if (!res.ok) throw new Error("Failed to update key");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-keys", providerId] });
    },
    onError: () => toast.error(t("updateError")),
  });

  const weightMutation = useMutation({
    mutationFn: async ({ keyId, weight }: { keyId: number; weight: number }) => {
      const res = await fetch(`/api/v1/providers/${providerId}/keys/${keyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight }),
      });
      if (!res.ok) throw new Error("Failed to update weight");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-keys", providerId] });
    },
    onError: () => toast.error(t("updateError")),
  });

  const resetCircuitMutation = useMutation({
    mutationFn: async (keyId: number) => {
      const res = await fetch(`/api/v1/providers/${providerId}/keys/${keyId}/reset-circuit`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to reset circuit");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-keys", providerId] });
      toast.success(t("resetSuccess"));
    },
    onError: () => toast.error(t("resetError")),
  });

  const keys = isEdit ? (data ?? []) : [];

  if (isEdit && isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }

  return (
    <div className="space-y-3">
      {keys.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("key")}</TableHead>
              <TableHead>{t("weight")}</TableHead>
              <TableHead>{t("enabled")}</TableHead>
              <TableHead>{t("circuit")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-mono text-xs max-w-[200px] truncate">
                  {k.key}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 w-20"
                    value={k.weight}
                    onChange={(e) => {
                      const w = Math.max(1, Number(e.target.value));
                      weightMutation.mutate({ keyId: k.id, weight: w });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={k.isEnabled}
                    onCheckedChange={(checked) =>
                      toggleMutation.mutate({ keyId: k.id, isEnabled: checked })
                    }
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <CircuitBadge state={k.circuit.state} />
                    {k.circuit.state !== "closed" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetCircuitMutation.mutate(k.id)}
                        disabled={resetCircuitMutation.isPending}
                      >
                        {t("resetCircuit")}
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(k.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : isEdit ? (
        <p className="text-sm text-muted-foreground">{t("noKeys")}</p>
      ) : null}

      {/* Inline add form */}
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-sm font-medium">{t("key")}</label>
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={t("keyPlaceholder")}
            className="font-mono text-sm"
          />
        </div>
        <div className="w-20 space-y-1">
          <label className="text-sm font-medium">{t("weight")}</label>
          <Input
            type="number"
            min={1}
            value={newWeight}
            onChange={(e) => setNewWeight(Math.max(1, Number(e.target.value)))}
          />
        </div>
          <Button
            size="sm"
            onClick={() => createMutation.mutate({ key: newKey, weight: newWeight })}
            disabled={!newKey.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            {t("addKey")}
          </Button>
        </div>
    </div>
  );
}