/**
 * 主角详情页面
 *
 * 功能：
 * 1. 展示指定主角的所有图库
 * 2. 显示该主角的别名列表（混名归并结果）
 * 3. 支持一键下载该主角的所有图库
 * 4. 显示主角的图库统计信息
 *
 * 数据特性：
 * - 主角名字已归一化
 * - 别名显示原始爬取的各种混名变体
 *
 * @date 2026-07-11
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, User, Image as ImageIcon, Download, Tag } from 'lucide-react';

// ============================================================
// 类型定义
// ============================================================

interface Gallery {
  id: number;
  title: string;
  coverUrl: string;
}

interface Alias {
  name: string;
  count: number;
}

interface ProtagonistStats {
  standardName: string;
  count: number;
  aliases: Alias[];
  galleries: Gallery[];
}

// ============================================================
// 组件
// ============================================================

export default function ProtagonistDetailPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);

  const [stats, setStats] = useState<ProtagonistStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (name) {
      fetchProtagonistStats();
    }
  }, [name]);

  async function fetchProtagonistStats() {
    try {
      setLoading(true);
      const response = await fetch(`/api/protagonists?name=${encodeURIComponent(name)}`);
      const result = await response.json();

      if (result.success) {
        setStats(result.data);
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
      {/* 返回按钮 */}
      <Link href="/protagonists">
        <Button variant="ghost" className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回主角列表
        </Button>
      </Link>

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
            onClick={fetchProtagonistStats}
            className="mt-4 text-primary hover:underline"
          >
            重试
          </button>
        </div>
      )}

      {/* 内容 */}
      {!loading && !error && stats && (
        <>
          {/* 主角信息头部 */}
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">{stats.standardName}</h1>
                <div className="flex items-center gap-4 mt-2 text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ImageIcon className="w-4 h-4" />
                    {stats.count} 个图库
                  </span>
                  {stats.aliases.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Tag className="w-4 h-4" />
                      {stats.aliases.length} 个别名
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 别名列表 */}
            {stats.aliases.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground mb-2">识别到的别名（已归并）：</p>
                <div className="flex flex-wrap gap-2">
                  {stats.aliases.map((alias) => (
                    <Badge key={alias.name} variant="secondary">
                      {alias.name} ({alias.count})
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="mt-6 flex gap-3">
              <Button>
                <Download className="w-4 h-4 mr-2" />
                一键下载全部
              </Button>
            </div>
          </div>

          {/* 图库网格 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {stats.galleries.map((gallery) => (
              <Link key={gallery.id} href={`/gallery/${gallery.id}`}>
                <Card className="group cursor-pointer hover:shadow-lg transition-shadow overflow-hidden">
                  {/* 封面图 */}
                  <div className="aspect-[3/4] relative bg-muted overflow-hidden">
                    {gallery.coverUrl ? (
                      <img
                        src={gallery.coverUrl}
                        alt={gallery.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <ImageIcon className="w-12 h-12" />
                      </div>
                    )}
                  </div>

                  {/* 标题 */}
                  <CardContent className="p-3">
                    <h3 className="text-sm line-clamp-2" title={gallery.title}>
                      {gallery.title}
                    </h3>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* 空状态 */}
          {stats.galleries.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>暂无图库数据</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
