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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

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
  providerId: number;
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

export function ProviderKeysSection({ providerId }: ProviderKeysSectionProps) {
  const t = useTranslations("settings.providers.form.keys");
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["provider-keys", providerId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/providers/${providerId}/keys`);
      if (!res.ok) throw new Error("Failed to fetch provider keys");
      const json = await res.json();
      return json.items as ProviderKey[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: { key: string; name?: string; weight: number }) => {
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
      setDialogOpen(false);
      setNewKey("");
      setNewName("");
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

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }

  const keys = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">{t("title")}</h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="mr-1 h-4 w-4" />
              {t("addKey")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("addKey")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("key")}</Label>
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder={t("keyPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("name")}</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("weight")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={newWeight}
                  onChange={(e) => setNewWeight(Math.max(1, Number(e.target.value)))}
                />
              </div>
              <Button
                onClick={() =>
                  createMutation.mutate({ key: newKey, name: newName || undefined, weight: newWeight })
                }
                disabled={!newKey.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {t("confirm")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noKeys")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
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
                <TableCell>{k.name ?? "-"}</TableCell>
                <TableCell className="font-mono text-xs">
                  {k.key.substring(0, 12)}...
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
      )}
    </div>
  );
}