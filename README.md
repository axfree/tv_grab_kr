# tv_grab_kr

XMLTV grabber for Korean TV channels

## Prerequisits

[Node.js](https://nodejs.org)

## Installation

<pre>
$ sudo npm install -g tv_grab_kr
</pre>

## Usage

<pre>
Usage: tv_grab_kr [options]

tv_grab_kr grabber by axfree

Options:

  -h, --help                    output usage information
  -v, --version                 output the version number
  -l, --list-channels           list all available channels
  -c, --list-channel-group      list all available channel group
  -g, --channel-filter [regex]  select only channels matching regular expression
  -n, --days [X]                supply data for X days
  -o, --offset [X]              start with data for day today plus X days
  -w, --output [FILENAME]       redirect xmltv output to the specified file
  -s, --sock [SOCKET]           redirect xmltv output to the specified XMLTV socket
      --description             print a description that identifies the grabber
      --capabilities            list the capabilities that a grabber supports
</pre>
