package resources

import (
	"embed"
)

// CoserJSON holds the pre-populated cosplay model database,
// used for protagonist name recognition during title parsing.
//
//go:embed model/coser.json
var CoserJSON []byte

// GameFS embeds all per-game character JSON files under game/.
// Each file contains a single game's metadata and character list,
// making it easy to add or update individual games without
// touching other data.
//
//go:embed game/*.json
var GameFS embed.FS
