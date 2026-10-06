-- Migration 003: Create game_characters and models tables
-- game_characters: normalized game character data for the "游戏资料" page
-- models: cosplay model database for title parsing persistence

-- GameCharacter: normalized character data from resources/game/*.json
CREATE TABLE IF NOT EXISTS game_characters (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    pinyin        TEXT NOT NULL DEFAULT '',
    aliases       TEXT NOT NULL DEFAULT '[]',
    game_name     TEXT NOT NULL DEFAULT '',
    game_name_en  TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_characters_game_name ON game_characters(game_name);
CREATE INDEX IF NOT EXISTS idx_game_characters_name ON game_characters(name);

-- Model: cosplay model database from resources/model/coser.json
CREATE TABLE IF NOT EXISTS models (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    pinyin        TEXT NOT NULL DEFAULT '',
    aliases       TEXT NOT NULL DEFAULT '[]',
    category      TEXT NOT NULL DEFAULT 'coser',
    notes         TEXT NOT NULL DEFAULT '',
    avatar_url    TEXT NOT NULL DEFAULT '',
    bio           TEXT NOT NULL DEFAULT '',
    gallery_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_models_pinyin ON models(pinyin);
CREATE INDEX IF NOT EXISTS idx_models_category ON models(category);
