"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

interface ModelDetailDialogProps {
  model: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ModelDetailResponse {
  model: string;
  overview: {
    totalCount: number;
    successCount: number;
    errorCount: number;
    avgDuration: number | null;
    totalCost: string;
    totalInputTokens: string;
    totalOutputTokens: string;
  };
  providers: Array<{
    id: number;
    name: string;
    type: string;
    count: number;
    successCount: number;
    avgDuration: number | null;
    totalCost: string;
  }>;
  dailyTrend: Array<{
    date: string;
    count: number;
    successCount: number;
  }>;
  days: number;
}

export function ModelDetailDialog({
  model,
  open,
  onOpenChange,
}: ModelDetailDialogProps) {
  const { data, isLoading } = useQuery<ModelDetailResponse>({
    queryKey: ["model-detail", model],
    queryFn: async () => {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(model)}?days=30`);
      if (!response.ok) {
        throw new Error("Failed to fetch model detail");
      }
      return response.json();
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold">
              {model}
            </code>
          </DialogTitle>
          <DialogDescription>模型详细信息和使用统计</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* 总体统计 */}
            <div>
              <h4 className="text-sm font-medium mb-3">总体统计（近 {data.days} 天）</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">总调用</p>
                  <p className="text-2xl font-bold">
                    {data.overview.totalCount.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">成功率</p>
                  <p className="text-2xl font-bold">
                    {data.overview.totalCount > 0
                      ? ((data.overview.successCount / data.overview.totalCount) * 100).toFixed(1)
                      : 0}
                    %
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">平均耗时</p>
                  <p className="text-2xl font-bold">
                    {data.overview.avgDuration
                      ? `${(data.overview.avgDuration / 1000).toFixed(1)}s`
                      : "N/A"}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">总费用</p>
                  <p className="text-2xl font-bold">
                    ${Number(data.overview.totalCost).toFixed(4)}
                  </p>
                </div>
              </div>
            </div>

            {/* Token 统计 */}
            <div>
              <h4 className="text-sm font-medium mb-3">Token 统计</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">输入 Tokens</p>
                  <p className="text-lg font-semibold">
                    {Number(data.overview.totalInputTokens).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">输出 Tokens</p>
                  <p className="text-lg font-semibold">
                    {Number(data.overview.totalOutputTokens).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            {/* 供应商列表 */}
            <div>
              <h4 className="text-sm font-medium mb-3">供应商分布</h4>
              <div className="space-y-3">
                {data.providers.map((provider) => {
                  const successRate =
                    provider.count > 0
                      ? ((provider.successCount / provider.count) * 100).toFixed(1)
                      : "0";
                  const percentage =
                    data.overview.totalCount > 0
                      ? ((provider.count / data.overview.totalCount) * 100).toFixed(1)
                      : "0";

                  return (
                    <div
                      key={provider.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-medium">{provider.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {provider.type} · 调用 {provider.count.toLocaleString()} 次 · 占比 {percentage}%
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={
                            Number(successRate) >= 95
                              ? "default"
                              : Number(successRate) >= 80
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {successRate}%
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {provider.avgDuration
                            ? `${(provider.avgDuration / 1000).toFixed(1)}s`
                            : "N/A"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
