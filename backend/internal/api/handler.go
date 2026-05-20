package api

import (
	"puchipix-backend/internal/config"
	"github.com/gin-gonic/gin"
)

type RouteRegistrar interface {
	RegisterRoutes(r *gin.Engine)
}

func SetupRouter(cfg *config.Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	InitWSHub()

	SetupProgressCallback()

	handler := NewHandler(cfg)
	handler.RegisterRoutes(r)

	return r
}