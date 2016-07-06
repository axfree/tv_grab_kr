#!/bin/sh
cat "$*" | socat - UNIX-CONNECT:/share/CACHEDEV1_DATA/.qpkg/TVHeadend/config/epggrab/xmltv.sock
