package logger

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

type Level int

const (
	DEBUG Level = iota
	INFO
	WARN
	ERROR
	FATAL
)

var levelNames = map[Level]string{
	DEBUG: "DEBUG",
	INFO:  "INFO",
	WARN:  "WARN",
	ERROR: "ERROR",
	FATAL: "FATAL",
}

var currentLevel Level = INFO
var logger *log.Logger

func Init(level string) {
	switch strings.ToUpper(level) {
	case "DEBUG":
		currentLevel = DEBUG
	case "INFO":
		currentLevel = INFO
	case "WARN":
		currentLevel = WARN
	case "ERROR":
		currentLevel = ERROR
	default:
		currentLevel = INFO
	}
	logger = log.New(os.Stdout, "", 0)
}

func logf(level Level, format string, args ...interface{}) {
	if level < currentLevel {
		return
	}
	now := time.Now().Format("2006-01-02 15:04:05.000")
	msg := fmt.Sprintf(format, args...)
	logger.Printf("[%s] [%s] %s", now, levelNames[level], msg)
	if level == FATAL {
		os.Exit(1)
	}
}

func Debug(format string, args ...interface{}) {
	logf(DEBUG, format, args...)
}

func Info(format string, args ...interface{}) {
	logf(INFO, format, args...)
}

func Warn(format string, args ...interface{}) {
	logf(WARN, format, args...)
}

func Error(format string, args ...interface{}) {
	logf(ERROR, format, args...)
}

func Fatal(format string, args ...interface{}) {
	logf(FATAL, format, args...)
}