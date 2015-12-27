tv_grab_kr
==========

XMLTV grabber for NAVER TV편성표 (tvguide.naver.com)

Prerequisits
============

nodejs

Installation
============

<pre>
# cd /usr/local
# git clone https://github.com/axfree/tv_grab_kr.git
# cd tv_grab_kr
# npm install
# cd ../bin
# ln -s ../tv_grab_kr/tv_grab_kr .
# tv_grab_kr -h
</pre>

Usage
=====

<pre>
Usage: node tv_grab_kr.js [OPTION]
Options:
  -e, --exclude-channel=CH1,CH2,... specify the channels to be excluded by using comma separated list
  -g, --channel-group=GR1,GR2,...   select channel group
  -h, --help                        show usage information
  -l, --list-channel-group          list all available channel group
  -n, --days=X                      supply data for X days
  -o, --offset=X                    start with data for day today plus X days
  -w, --output=FILENAME             redirect xmltv output to the specified file
  -s, --sock=SOCKET                 redirect xmltv output to the specified XMLTV socket
</pre>
