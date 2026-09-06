// Deprecated: fixtures are fetched with Steam accounts from Postgres.
//
//	bun run parser:fetch-patches
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "use: bun run parser:fetch-patches")
	fmt.Fprintln(os.Stderr, "  (--only 7.39,7.38 to limit patches)")
	os.Exit(2)
}
