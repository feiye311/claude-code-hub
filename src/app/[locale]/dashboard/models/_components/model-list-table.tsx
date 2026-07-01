"use client";

import { Check, Copy, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelDetailDialog } from "./model-detail-dialog";
import { ModelTestDialog } from "./model-test-dialog";

interface ModelProvider {
  id: number;
  name: string;
  count: number;
}

interface ModelItem {
  model: string;
  totalCount: number;
  successCount: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  providers: ModelProvider[];
  providerCount: number;
}

interface ModelListTableProps {
  models: ModelItem[];
}

export function ModelListTable({ models }: ModelListTableProps) {
  const [copiedModel, setCopiedModel] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelItem | null>(null);
  const [testModel, setTestModel] = useState<ModelItem | null>(null);

  const handleCopy = (model: string) => {
    navigator.clipboard.writeText(model);
    setCopiedModel(model);
    setTimeout(() => setCopiedModel(null), 2000);
  };

  const successRate = (item: ModelItem) => {
    if (item.totalCount === 0) return 0;
    return ((item.successCount / item.totalCount) * 100).toFixed(1);
  };

  const formatTokens = (n: number) => {
    if (n === 0) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  if (models.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        暂无模型数据
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">模型名称</TableHead>
              <TableHead className="text-right">调用次数</TableHead>
              <TableHead className="text-right">成功率</TableHead>
              <TableHead className="text-right">输入 Tokens</TableHead>
              <TableHead className="text-right">输出 Tokens</TableHead>
              <TableHead>供应商</TableHead>
              <TableHead className="text-right w-[140px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((item) => (
              <TableRow key={item.model}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold">
                      {item.model}
                    </code>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleCopy(item.model)}
                          >
                            {copiedModel === item.model ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>复制模型 ID</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {item.totalCount.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {item.totalCount === 0 ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      未使用
                    </Badge>
                  ) : (
                    <Badge
                      variant={
                        Number(successRate(item)) >= 95
                          ? "default"
                          : Number(successRate(item)) >= 80
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {successRate(item)}%
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {formatTokens(item.totalInputTokens)}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {formatTokens(item.totalOutputTokens)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.providers.slice(0, 3).map((p) => (
                      <Badge key={p.id} variant="outline" className="text-xs">
                        {p.name}
                        <span className="ml-1 text-muted-foreground">({p.count})</span>
                      </Badge>
                    ))}
                    {item.providers.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{item.providers.length - 3}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedModel(item)}>
                      详情
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setTestModel(item)}>
                      <MessageSquare className="h-4 w-4 mr-1" />
                      测试
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 模型详情对话框 */}
      {selectedModel && (
        <ModelDetailDialog
          model={selectedModel.model}
          open={!!selectedModel}
          onOpenChange={(open) => {
            if (!open) setSelectedModel(null);
          }}
        />
      )}

      {/* 模型测试对话框 */}
      {testModel && (
        <ModelTestDialog
          model={testModel.model}
          providers={testModel.providers}
          open={!!testModel}
          onOpenChange={(open) => {
            if (!open) setTestModel(null);
          }}
        />
      )}
    </>
  );
}
