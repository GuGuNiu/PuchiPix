/**
 * 主角展示架页面
 *
 * 功能：
 * 1. 展示所有已爬取的主角（模特/coser）列表
 * 2. 每个主角显示图库数量和最新封面
 * 3. 点击主角进入个人详情页
 * 4. 支持搜索主角名字
 *
 * 数据特性：
 * - 主角名字已经过归一化处理（混名合并）
 * - 显示别名信息（如"樱井宁宁ningning"会归并到"樱井宁宁"）
 *
 * @date 2026-07-11
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, User, Image as ImageIcon } from 'lucide-react';

// ============================================================
// 类型定义
// ============================================================

interface Protagonist {
  name: string;
  count: number;
  coverUrl: string;
}

// ============================================================
// 组件
// ============================================================

export default function ProtagonistsPage() {
  const [protagonists, setProtagonists] = useState<Protagonist[]>([]);
  const [filtered, setFiltered] = useState<Protagonist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');

  // 加载主角列表
  useEffect(() => {
    fetchProtagonists();
  }, []);

  // 搜索过滤
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFiltered(protagonists);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = protagonists.filter((p) =>
      p.name.toLowerCase().includes(query)
    );
    setFiltered(filtered);
  }, [searchQuery, protagonists]);

  async function fetchProtagonists() {
    try {
      setLoading(true);
      const response = await fetch('/api/protagonists');
      const result = await response.json();

      if (result.success) {
        setProtagonists(result.data.protagonists);
        setFiltered(result.data.protagonists);
      } else {
        setError(result.error || '加载失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <div className="container mx-auto px-4 py-8">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">主角展示架</h1>
        <p className="text-muted-foreground">
          已归一化的主角列表，点击可查看该主角的所有图库
        </p>
      </div>

      {/* 搜索框 */}
      <div className="mb-6">
        <Input
          type="text"
          placeholder="搜索主角名字..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-md"
        />
      </div>

      {/* 统计信息 */}
      <div className="mb-6 flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <User className="w-4 h-4" />
          共 {filtered.length} 位主角
        </span>
        <span className="flex items-center gap-1">
          <ImageIcon className="w-4 h-4" />
          总计 {filtered.reduce((sum, p) => sum + p.count, 0)} 个图库
        </span>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">加载中...</span>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="text-center py-20 text-red-500">
          <p>{error}</p>
          <button
            onClick={fetchProtagonists}
            className="mt-4 text-primary hover:underline"
          >
            重试
          </button>
        </div>
      )}

      {/* 主角网格 */}
      {!loading && !error && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((protagonist) => (
            <Link
              key={protagonist.name}
              href={`/protagonists/${encodeURIComponent(protagonist.name)}`}
            >
              <Card className="group cursor-pointer hover:shadow-lg transition-shadow overflow-hidden">
                {/* 封面图 */}
                <div className="aspect-[3/4] relative bg-muted overflow-hidden">
                  {protagonist.coverUrl ? (
                    <img
                      src={protagonist.coverUrl}
                      alt={protagonist.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <User className="w-12 h-12" />
                    </div>
                  )}

                  {/* 图库数量徽章 */}
                  <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-full">
                    {protagonist.count} 个图库
                  </div>
                </div>

                {/* 主角名字 */}
                <CardContent className="p-3">
                  <h3 className="font-medium text-center truncate">
                    {protagonist.name}
                  </h3>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <User className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>暂无主角数据</p>
          <p className="text-sm mt-2">请先爬取一些图库</p>
        </div>
      )}
    </div>
  );
}
