import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Users, Gamepad2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface CharEntry {
  id: number;
  name: string;
  pinyin: string;
  aliases: string[];
  gameName: string;
  gameNameEn: string;
}

interface GameGroup {
  gameName: string;
  gameNameEn: string;
  characters: CharEntry[];
}

export default function GameCharactersPage(): React.JSX.Element {
  const { t } = useI18n();
  const [games, setGames] = useState<GameGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedGames, setExpandedGames] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/game-characters", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((data) => {
        setGames(data);
        if (data.length > 0) {
          setExpandedGames(new Set(data.map((g: GameGroup) => g.gameName)));
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const toggleGame = (gameName: string): void => {
    setExpandedGames((prev) => {
      const next = new Set(prev);
      if (next.has(gameName)) next.delete(gameName);
      else next.add(gameName);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-1">{t("nav.gameCharacters")}</h1>
        <p className="text-sm text-gray-500 mt-6 text-center">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-1">{t("nav.gameCharacters")}</h1>
        <p className="text-sm text-red-500 mt-6 text-center">{error}</p>
      </div>
    );
  }

  const totalChars = games.reduce((sum, g) => sum + g.characters.length, 0);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">{t("nav.gameCharacters")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {games.length} games · {totalChars} characters
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {games.map((game) => {
          const isExpanded = expandedGames.has(game.gameName);
          return (
            <div
              key={game.gameName}
              className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900"
            >
              <button
                className="flex items-center gap-3 w-full px-4 py-3.5 border-0 bg-transparent cursor-pointer text-left text-[15px] text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                onClick={() => toggleGame(game.gameName)}
              >
                <span className="text-gray-400 flex-shrink-0">
                  {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </span>
                <span className="text-indigo-500 flex-shrink-0">
                  <Gamepad2 size={18} />
                </span>
                <span className="flex-1 font-medium">
                  {game.gameName}
                  {game.gameNameEn && (
                    <span className="text-gray-400 dark:text-gray-500 font-normal text-[13px] ml-1">
                      · {game.gameNameEn}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-gray-400 text-[13px] flex-shrink-0">
                  <Users size={14} />
                  <span>{game.characters.length}</span>
                </span>
              </button>

              {isExpanded && (
                <div className="flex flex-wrap gap-1.5 px-4 pb-4 pt-0 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
                  {game.characters.map((char) => (
                    <span
                      key={char.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-[13px] hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
                    >
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {char.name}
                      </span>
                      {char.aliases.length > 0 &&
                        char.aliases.map((a, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-px rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 text-[11px] font-normal"
                          >
                            {a}
                          </span>
                        ))}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
