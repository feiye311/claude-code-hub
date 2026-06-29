"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelListTable } from "./model-list-table";

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
  providers: ModelProvider[];
  providerCount: number;
}

interface ModelListResponse {
  data: ModelItem[];
  total: number;
  page: number;
  pageSize: number;
  days: number;
}

export function ModelListContainer() {
  const [search, setSearch] = useState("");
  const [days, setDays] = useState("30");
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading, error } = useQuery<ModelListResponse>({
    queryKey: ["models", search, days, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        days,
        page: page.toString(),
        pageSize: "50",
      });
      if (search) params.set("search", search);

      const response = await fetch(`/api/v1/models?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch models");
      }
      return response.json();
    },
  });

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="space-y-4">
      {/* 搜索和过滤栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索模型名称..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={handleSearch}>
          搜索
        </Button>
        <Select value={days} onValueChange={(value) => { setDays(value); setPage(1); }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="统计周期" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">近 7 天</SelectItem>
            <SelectItem value="30">近 30 天</SelectItem>
            <SelectItem value="90">近 90 天</SelectItem>
            <SelectItem value="365">近 1 年</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 加载状态 */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="flex items-center justify-center py-12 text-destructive">
          加载失败: {error.message}
        </div>
      )}

      {/* 模型列表表格 */}
      {data && (
        <>
          <ModelListTable models={data.data} />
          
          {/* 分页 */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              共 {data.total} 个模型
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <span className="text-sm">
                第 {data.page} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={data.data.length < 50}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
