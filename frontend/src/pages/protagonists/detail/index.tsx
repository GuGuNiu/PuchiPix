import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, User, Image as ImageIcon, Download, Tag } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

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

export default function ProtagonistDetailPage(): React.JSX.Element {
  const { t } = useI18n();
  const params = useParams();
  /*
   * React Router v7 useParams already decodes URL params; decoding again
   * here would double-decode names containing '%' and can even throw
   * URIError.
   */
  const name = params.name ?? '';

  const [stats, setStats] = useState<ProtagonistStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Request sequence: drop stale responses when the route param changes fast.
  const requestSeq = useRef(0);

  const fetchProtagonistStats = useCallback(async (): Promise<void> => {
    const seq = ++requestSeq.current;
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`/api/protagonists?name=${encodeURIComponent(name)}`);
      if (seq !== requestSeq.current) return; // Superseded by a newer request.
      const result = await response.json();

      if (result.success) {
        setStats(result.data);
      } else {
        setError(result.error || t('protagonists.loadFailed'));
      }
    } catch {
      if (seq !== requestSeq.current) return;
      setError(t('protagonists.networkError'));
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
      }
    }
  }, [name, t]);

  useEffect(() => {
    if (name) {
      fetchProtagonistStats();
    } else {
      // Empty name (e.g. visiting /protagonists/ directly) is invalid.
      setLoading(false);
      setError(t('protagonists.loadFailed'));
    }
    return () => {
      requestSeq.current++; // Invalidate in-flight requests on unmount.
    };
  }, [name, fetchProtagonistStats, t]);

  return (
    <div className="container mx-auto px-4 py-8 flex flex-col min-h-0" style={{ height: '100%' }}>
      <Link to="/protagonists">
        <Button variant="ghost" className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t('protagonists.backToList')}
        </Button>
      </Link>

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
            onClick={fetchProtagonistStats}
            className="mt-4 text-primary hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !error && stats && (
        <>
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
                    {t('protagonists.statGalleries', { count: stats.count })}
                  </span>
                  {stats.aliases.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Tag className="w-4 h-4" />
                      {t('protagonists.statAliases', { count: stats.aliases.length })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {stats.aliases.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground mb-2">{t('protagonists.detectedAliases')}</p>
                <div className="flex flex-wrap gap-2">
                  {stats.aliases.map((alias) => (
                    <Badge key={alias.name} variant="secondary">
                      {alias.name} ({alias.count})
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <Button>
                <Download className="w-4 h-4 mr-2" />
                {t('protagonists.downloadAll')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {stats.galleries.map((gallery) => (
              /* /shelf/:id has no route definition and would 404; link to /shelf/photos?id=xxx which opens the matching detail panel. */
              <Link key={gallery.id} to={`/shelf/photos?id=${gallery.id}`}>
                <Card className="group cursor-pointer hover:shadow-lg transition-shadow overflow-hidden">
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

                  <CardContent className="p-3">
                    <h3 className="text-sm line-clamp-2" title={gallery.title}>
                      {gallery.title}
                    </h3>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {stats.galleries.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center min-h-0 text-muted-foreground">
              <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
              <p>{t('protagonists.noGalleries')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
