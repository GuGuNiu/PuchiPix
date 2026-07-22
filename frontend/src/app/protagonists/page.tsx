'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, User, Image as ImageIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface Protagonist {
  name: string;
  count: number;
  coverUrl: string;
}

export default function ProtagonistsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [protagonists, setProtagonists] = useState<Protagonist[]>([]);
  const [filtered, setFiltered] = useState<Protagonist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProtagonists();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFiltered(protagonists);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = protagonists.filter((p) =>
      p.name.toLowerCase().includes(query)
    );
    setFiltered(filtered);
  }, [searchQuery, protagonists]);

  async function fetchProtagonists(): Promise<void> {
    try {
      setLoading(true);
      const response = await fetch('/api/protagonists');
      const result = await response.json();

      if (result.success) {
        setProtagonists(result.data.protagonists);
        setFiltered(result.data.protagonists);
      } else {
        setError(result.error || t('protagonists.loadFailed'));
      }
    } catch {
      setError(t('protagonists.networkError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 flex flex-col min-h-0" style={{ height: '100%' }}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('protagonists.title')}</h1>
        <p className="text-muted-foreground">
          {t('protagonists.subtitle')}
        </p>
      </div>

      <div className="mb-6">
        <Input
          type="text"
          placeholder={t('protagonists.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-md"
        />
      </div>

      <div className="mb-6 flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <User className="w-4 h-4" />
          {t('protagonists.totalCount', { count: filtered.length })}
        </span>
        <span className="flex items-center gap-1">
          <ImageIcon className="w-4 h-4" />
          {t('protagonists.totalGalleries', { count: filtered.reduce((sum, p) => sum + p.count, 0) })}
        </span>
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center min-h-0">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">{t('common.loading')}</span>
        </div>
      )}

      {error && (
        <div className="flex flex-1 flex-col items-center justify-center min-h-0 text-red-500">
          <p>{error}</p>
          <button
            onClick={fetchProtagonists}
            className="mt-4 text-primary hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((protagonist) => (
            <Link
              key={protagonist.name}
              href={`/protagonists/${encodeURIComponent(protagonist.name)}`}
            >
              <Card className="group cursor-pointer hover:shadow-lg transition-shadow overflow-hidden">
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

                  <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-full">
                    {t('protagonists.statGalleries', { count: protagonist.count })}
                  </div>
                </div>

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

      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center min-h-0 text-muted-foreground">
          <User className="w-16 h-16 mb-4 opacity-50" />
          <p>{t('common.noData')}</p>
          <p className="text-sm mt-2">{t('protagonists.emptyHint')}</p>
        </div>
      )}
    </div>
  );
}
