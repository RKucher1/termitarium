// numbatd is a standalone main package with no third-party dependencies.
// It needs its own module file because Go 1.16+ refuses to build outside a
// module — without this, install.sh's build step fails on a fresh clone.
module termitarium/numbatd

go 1.21
