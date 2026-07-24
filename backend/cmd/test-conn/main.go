package main

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func main() {
	ctx := context.Background()

	// Try direct connect without pool
	conn, err := pgx.Connect(ctx, "postgres://puchipix:puchipix@127.0.0.1:5432/postgres?sslmode=disable")
	if err != nil {
		fmt.Printf("direct connect error: %v\n", err)
	} else {
		fmt.Println("CONNECTED!")
		var v int
		conn.QueryRow(ctx, "SELECT 1").Scan(&v)
		fmt.Printf("SELECT 1 = %d\n", v)
		conn.Close(ctx)
	}

	// Try with different host formats
	for _, host := range []string{"127.0.0.1", "localhost"} {
		dsn := fmt.Sprintf("postgres://puchipix:puchipix@%s:5432/postgres?sslmode=disable", host)
		conn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			fmt.Printf("%s: %v\n", host, err)
			continue
		}
		fmt.Printf("%s: CONNECTED!\n", host)
		conn.Close(ctx)
	}
}
