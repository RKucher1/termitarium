function nb --description "numbat-tools control"
    set -l port __PORT__
    set -l dir __DIR__
    switch "$argv[1]"
        case view ""
            open "http://127.0.0.1:$port/"
        case start
            launchctl load ~/Library/LaunchAgents/com.numbat-tools.numbatd.plist 2>/dev/null
            echo "numbatd started"
        case stop
            launchctl unload ~/Library/LaunchAgents/com.numbat-tools.numbatd.plist 2>/dev/null
            echo "numbatd stopped"
        case status
            if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$port/api/sources"
                echo "numbatd  running   http://127.0.0.1:$port/"
                curl -s "http://127.0.0.1:$port/api/sources"
                echo
            else
                echo "numbatd  not responding — try: nb start"
            end
        case prune
            $dir/bin/numbat-prune $argv[2..-1]
        case logs
            tail -n 30 $dir/numbatd.log
        case help -h --help
            printf "  %-24s %s\n" "nb view"      "open the record viewer (default)"
            printf "  %-24s %s\n" "nb status"    "daemon health + source list"
            printf "  %-24s %s\n" "nb start|stop" "control the daemon"
            printf "  %-24s %s\n" "nb logs"      "tail the daemon log"
            printf "  %-24s %s\n" "nb prune -n"  "dry-run retention"
            printf "  %-24s %s\n" "nb prune -d N" "apply an N-day window"
        case '*'
            echo "unknown: nb $argv[1]  —  try: nb help"
    end
end

complete -c nb -f
complete -c nb -n __fish_use_subcommand -a view   -d "open the viewer"
complete -c nb -n __fish_use_subcommand -a status -d "daemon health"
complete -c nb -n __fish_use_subcommand -a start  -d "start daemon"
complete -c nb -n __fish_use_subcommand -a stop   -d "stop daemon"
complete -c nb -n __fish_use_subcommand -a logs   -d "tail daemon log"
complete -c nb -n __fish_use_subcommand -a prune  -d "retention"
complete -c nb -n __fish_use_subcommand -a help   -d "list commands"
