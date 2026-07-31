// numbatd — minimal hardened localhost server for the numbat record viewer.
//
//   GET  /              the viewer (tools/viewer.html)
//   GET  /api/sources   JSON list of *.ndjson files in the numbat dir
//   GET  /files/{name}  a whitelisted .ndjson file (HEAD supported)
//
// Security posture:
//   * binds 127.0.0.1 only
//   * Host header must be a loopback host (defeats DNS rebinding)
//   * no CORS headers ever (browser pages cannot read responses)
//   * filename whitelist, no path traversal, no directory listing
//   * X-Content-Type-Options: nosniff, Cache-Control: no-store
package main

import (
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var (
	dir      string
	addr     string
	nameOK   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*\.ndjson$`)
	hostOK   = regexp.MustCompile(`^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$`)
)

type source struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Size    int64  `json:"size"`
	ModTime string `json:"mtime"`
}

func guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !hostOK.MatchString(strings.ToLower(r.Host)) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Cache-Control", "no-store")
		h.Set("Referrer-Policy", "no-referrer")
		next(w, r)
	}
}

func viewer(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/index.html" {
		http.NotFound(w, r)
		return
	}
	p := filepath.Join(dir, "tools", "viewer.html")
	if _, err := os.Stat(p); err != nil {
		http.Error(w, "viewer.html not found under "+filepath.Join(dir, "tools"), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeFile(w, r, p)
}

func sources(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		http.Error(w, "cannot read data directory", http.StatusInternalServerError)
		return
	}
	out := []source{}
	for _, e := range entries {
		if e.IsDir() || !nameOK.MatchString(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, source{
			Name:    e.Name(),
			URL:     "/files/" + e.Name(),
			Size:    info.Size(),
			ModTime: info.ModTime().UTC().Format(time.RFC3339),
		})
	}
	// biggest first so the primary log loads by default
	sort.Slice(out, func(i, j int) bool { return out[i].Size > out[j].Size })
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func files(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/files/")
	if !nameOK.MatchString(name) || strings.ContainsAny(name, "/\\") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	p := filepath.Join(dir, name)
	// resolve and confirm the file is truly inside dir (paranoia over symlinks)
	rp, err := filepath.EvalSymlinks(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	rd, err := filepath.EvalSymlinks(dir)
	if err != nil || !strings.HasPrefix(rp, rd+string(os.PathSeparator)) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	http.ServeFile(w, r, rp) // handles HEAD, Range, Last-Modified
}

func main() {
	home, _ := os.UserHomeDir()
	flag.StringVar(&dir, "dir", filepath.Join(home, ".numbat"), "numbat data directory")
	flag.StringVar(&addr, "addr", "127.0.0.1:8787", "listen address (loopback only)")
	flag.Parse()

	host, _, err := net.SplitHostPort(addr)
	if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
		log.Fatal("numbatd: refusing to bind non-loopback address: ", addr)
	}
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		log.Fatal("numbatd: data directory missing: ", dir)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", guard(viewer))
	mux.HandleFunc("/api/sources", guard(sources))
	mux.HandleFunc("/files/", guard(files))

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	log.Printf("numbatd: serving %s on http://%s/", dir, addr)
	log.Fatal(srv.ListenAndServe())
}
