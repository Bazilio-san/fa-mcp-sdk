#!/usr/bin/bash

# srv.sh - Unified systemd service management script
# Consolidates functionality from deploy/systemd-service/ scripts
# Can be run from project root or from deploy/ directory

# Colors for output
c="\e[1;36m"; lc="\e[0;36m";
g="\e[1;32m"; lg="\e[0;32m";
m="\e[1;35m"; lm="\e[0;35m";
r="\e[1;31m"; lr="\e[0;31m";
y="\e[1;33m"; ly="\e[0;33m";
c0='\033[0;0m'

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"  # Parent directory (project root)
SERVICE_NAME=""
NODE_VERSION=""
PORT=""
COMMAND=""

# Function to show usage
show_usage() {
    echo "Usage:"
    echo "  $0 i|install [-n <service_name>] [-v <node_version>]"
    echo "  $0 d|delete  [-n <service_name>] [-p <port>]"
    echo "  $0 r|reinstall [-n <service_name>] [-p <port>] [-v <node_version>]"
    echo ""
    echo "Commands:"
    echo "  i, install    - Install and start systemd service"
    echo "  d, delete     - Stop and remove systemd service"
    echo "  r, reinstall  - Reinstall service (delete + install)"
    echo ""
    echo "Options:"
    echo "  -n <name>     - Alternative service name (default: from package.json)"
    echo "  -v <version>  - Node.js version (default: auto-detected)"
    echo "  -p <port>     - Port number for service cleanup (default: auto-detected)"
    echo ""
    echo "Working directories:"
    echo "  Script location: $SCRIPT_DIR"
    echo "  Project root: $PROJECT_ROOT"
}

# Function to check if service exists
service_exists() {
    local n=$1
    if [[ $(systemctl list-units --all -t service --full --no-legend "$n.service" | sed 's/●//g' | sed 's/^\s*//g' | cut -f1 -d' ') == $n.service ]]; then
        return 0
    else
        return 1
    fi
}

# Function to detect Node.js version
detect_node_version() {
    local version=""

    # 1. Use provided version parameter
    if [ -n "$NODE_VERSION" ]; then
        version="$NODE_VERSION"
        echo -e "$c**** Using provided Node.js version: $g$version$c ****$c0" >&2
    # 2. Try to find version in .envrc (in project root)
    elif [ -f "$PROJECT_ROOT/.envrc" ]; then
        version=$(grep -E "^\s*nvm\s+use\s+" "$PROJECT_ROOT/.envrc" | sed -E 's/^\s*nvm\s+use\s+([0-9]+\.[0-9]+\.[0-9]+).*/\1/' | head -n1)
        if [ -n "$version" ]; then
            echo -e "$c**** Found Node.js version in .envrc: $g$version$c ****$c0" >&2
        fi
    fi

    # 3. Fallback to current node version
    if [ -z "$version" ]; then
        version=$(node -v 2>/dev/null | sed 's/^v//')
        if [ -n "$version" ]; then
            echo -e "$c**** Using current Node.js version: $g$version$c ****$c0" >&2
        else
            echo -e "$r**** Error: Could not detect Node.js version ****$c0" >&2
            exit 1
        fi
    fi

    echo "$version"
}

# Function to find Node.js binary path
find_node_path() {
    local version="$1"
    local node_path=""

    # Try NVM path first
    local nvm_path="$HOME/.nvm/versions/node/v$version/bin/node"
    if [ -f "$nvm_path" ]; then
        node_path="$nvm_path"
        echo -e "$c**** Found Node.js at NVM path: $g$node_path$c ****$c0" >&2
    else
        # Try system node
        node_path=$(which node 2>/dev/null)
        if [ -n "$node_path" ]; then
            local current_version=$(node -v 2>/dev/null | sed 's/^v//')
            if [ "$current_version" = "$version" ]; then
                echo -e "$c**** Found Node.js at system path: $g$node_path$c ****$c0" >&2
            else
                echo -e "$y**** Warning: System Node.js version ($current_version) differs from target ($version) ****$c0" >&2
                echo -e "$c**** Using system path anyway: $g$node_path$c ****$c0" >&2
            fi
        else
            echo -e "$r**** Error: Could not find Node.js binary ****$c0" >&2
            exit 1
        fi
    fi

    echo "$node_path"
}

# Function to parse package.json
parse_package_json() {
    local field="$1"
    local package_file="$PROJECT_ROOT/package.json"

    if [ ! -f "$package_file" ]; then
        echo -e "$r**** Error: package.json not found at $package_file ****$c0" >&2
        exit 1
    fi

    # Simple JSON parsing using node (execute from project root for proper require resolution)
    local value=$(cd "$PROJECT_ROOT" && node -e "
        try {
            const pkg = require('./package.json');
            console.log(pkg.$field || '');
        } catch(e) {
            process.exit(1);
        }
    " 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$value" ]; then
        echo -e "$r**** Error: Could not parse $field from package.json ****$c0" >&2
        exit 1
    fi

    echo "$value"
}

# Function to get service name
get_service_name() {
    if [ -n "$SERVICE_NAME" ]; then
        echo "$SERVICE_NAME"
    else
        parse_package_json "name"
    fi
}

# Function to detect port from config
detect_port() {
    local port=""

    if [ -n "$PORT" ]; then
        port="$PORT"
    else
        # Try to get port from config using node (execute from project root for proper require resolution)
        port=$(cd "$PROJECT_ROOT" && node -e 'try{const c=require("config");console.log(c.webServer?.port);}catch(e){import("config").then(c=>console.log(c.webServer?.port)).catch(()=>{});}' 2>/dev/null | grep -oE "[0-9]{2,5}" | head -n1)

        if [ -z "$port" ]; then
            echo -e "$r**** Error: Could not detect port from config ****$c0" >&2
            exit 1
        fi
    fi

    echo "$port"
}

# Function to generate systemd unit file
generate_unit_file() {
    local service_name="$1"
    local node_path="$2"
    local main_file="$3"
    local working_dir="$PROJECT_ROOT"  # Always use project root as working directory
    local serviceFile="/etc/systemd/system/${service_name}.service"
    cat > "$serviceFile" << EOF
[Unit]
Description=$service_name
After=network.target
# https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#StartLimitIntervalSec=interval
StartLimitIntervalSec=0

[Service]
User=root
WorkingDirectory=$working_dir
EnvironmentFile=$working_dir/.env
ExecStart=$node_path $main_file
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

    echo -e "$c**** Generated unit file for $g$service_name$c ****$c0" >&2
    echo -e "$lc   WorkingDirectory: $g$working_dir$c0" >&2
    echo -e "$lc   ExecStart: $g$node_path $main_file$c0" >&2
    echo -e "$lc   View Service file: ${g}cat $serviceFile$c0" >&2
}

# Function to install service
install_service() {
    echo -e "$c**** Installing service ****$c0"

    # Detect Node.js version and path
    local node_version=$(detect_node_version)
    local node_path=$(find_node_path "$node_version")

    # Get main entry point and service name
    local main_file=$(parse_package_json "main")
    local service_name=$(get_service_name)

    echo -e "$c**** Service configuration ****$c0"
    echo -e "$lc   Service name: $g$service_name$c0"
    echo -e "$lc   Node.js version: $g$node_version$c0"
    echo -e "$lc   Node.js path: $g$node_path$c0"
    echo -e "$lc   Main file: $g$main_file$c0"
    echo -e "$lc   Project root: $g$PROJECT_ROOT$c0"

    # Check if service already exists
    if service_exists "$service_name"; then
        echo -e "$c**** Service $g$service_name$c already installed ****$c0"
        return 0
    fi

    # Generate and install unit file
    generate_unit_file "$service_name" "$node_path" "$main_file"

    # Reload systemd and enable service
    systemctl daemon-reload
    systemctl enable --now "$service_name"

    if [ $? -eq 0 ]; then
        echo -e "$c**** Service $g$service_name$c installed and started ****$c0"
        echo ""
        echo -e "${m}View status: ${y}systemctl -l status $service_name$c0"
        echo -e "${m}View logs: ${y}journalctl -o cat -xefu $service_name$c0"
    else
        echo -e "$r**** Error: Failed to install service $service_name ****$c0"
        exit 1
    fi
}

# Function to delete service
delete_service() {
    local service_name=$(get_service_name)
    local port=$(detect_port)

    echo -e "$c**** Removing service $g$service_name$c listening on port $g$port$c ****$c0"

    if ! service_exists "$service_name"; then
        echo -e "$c**** Service $g$service_name$c not found ****$c0"
        return 0
    fi

    # Stop and disable service
    systemctl stop "$service_name"
    systemctl disable "$service_name"

    # Remove unit file
    rm -f "/etc/systemd/system/$service_name.service"

    # Kill any remaining process on the port
    local pid=$(lsof -i tcp:$port 2>/dev/null | grep $port | awk '{print $2}' | head -1)
    if [ -n "$pid" ]; then
        echo -e "$c**** Killing process $g$pid$c on port $g$port$c ****$c0"
        kill -9 "$pid"
    fi

    # Reload systemd
    systemctl daemon-reload

    echo -e "$c**** Service $g$service_name$c removed ****$c0"
}

# Function to reinstall service
reinstall_service() {
    echo -e "$c**** Reinstalling service ****$c0"

    # Delete existing service
    delete_service

    # Install service
    install_service

    local service_name=$(get_service_name)
    echo -e "$c**** Service $g$service_name$c reinstalled ****$c0"

    # Show status and logs
    systemctl status "$service_name"
    echo ""
    echo -e "${m}Following logs (Ctrl+C to exit): ${y}journalctl -o cat -xefu $service_name$c0"
    journalctl -o cat -xefu "$service_name"
}

# Parse command line arguments
if [ $# -eq 0 ]; then
    show_usage
    exit 1
fi

# Parse command
case "$1" in
    i|install)
        COMMAND="install"
        shift
        ;;
    d|delete)
        COMMAND="delete"
        shift
        ;;
    r|reinstall)
        COMMAND="reinstall"
        shift
        ;;
    *)
        echo -e "$r**** Error: Unknown command '$1' ****$c0"
        show_usage
        exit 1
        ;;
esac

# Parse options
while [[ $# -gt 0 ]]; do
    case $1 in
        -n)
            SERVICE_NAME="$2"
            shift 2
            ;;
        -v)
            NODE_VERSION="$2"
            shift 2
            ;;
        -p)
            PORT="$2"
            shift 2
            ;;
        *)
            echo -e "$r**** Error: Unknown option '$1' ****$c0"
            show_usage
            exit 1
            ;;
    esac
done

# Execute command
case "$COMMAND" in
    install)
        install_service
        ;;
    delete)
        delete_service
        ;;
    reinstall)
        reinstall_service
        ;;
esac
