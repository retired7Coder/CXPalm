package config

import (
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

const Version = "0.0.13"

type Config struct {
	TrustedProxyIP bool   `json:"trustedProxyIP,omitempty"`
	Listen         string `json:"listen"`
	Origin         string `json:"origin"`
	DataDir        string `json:"dataDir"`
	CodexHome      string `json:"codexHome"`
	IPCPath        string `json:"ipcPath"`
	CodexBin       string `json:"codexBin,omitempty"`
	SSHHost        string `json:"sshHost,omitempty"`
	SSHUser        string `json:"sshUser,omitempty"`
	SSHPort        int    `json:"sshPort,omitempty"`
	SSHRemotePort  int    `json:"sshRemotePort,omitempty"`
}

func Load(path string) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err = json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	return c, c.Validate()
}

func (c *Config) Validate() error {
	host, port, err := net.SplitHostPort(c.Listen)
	portNumber, portErr := strconv.Atoi(port)
	if err != nil || host != "127.0.0.1" || portErr != nil || portNumber < 1 || portNumber > 65535 {
		return errors.New("listen must bind to 127.0.0.1 with a fixed port")
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || strings.ContainsAny(c.Origin, "?#") || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return errors.New("origin must be an HTTPS origin without credentials, path, query or fragment")
	}
	if originPort := u.Port(); originPort != "" {
		number, err := strconv.Atoi(originPort)
		if err != nil || number < 1 || number > 65535 {
			return errors.New("origin port must be 1-65535")
		}
	} else if strings.HasSuffix(u.Host, ":") {
		return errors.New("origin port must be 1-65535")
	}
	c.Origin = strings.TrimSuffix(c.Origin, "/")
	if c.SSHHost != "" {
		if net.ParseIP(c.SSHHost) == nil && !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$`).MatchString(c.SSHHost) {
			return errors.New("sshHost must be a hostname, IP address or SSH alias, without username or options")
		}
		if c.SSHRemotePort < 1024 || c.SSHRemotePort > 65535 {
			return errors.New("sshRemotePort must be 1024-65535")
		}
	}
	if c.SSHUser != "" && !regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$`).MatchString(c.SSHUser) {
		return errors.New("sshUser must be a login name without options or whitespace")
	}
	if c.SSHPort < 0 || c.SSHPort > 65535 {
		return errors.New("sshPort must be 1-65535, or 0 to use OpenSSH defaults")
	}
	if c.SSHHost == "" && (c.SSHUser != "" || c.SSHPort != 0 || c.SSHRemotePort != 0) {
		return errors.New("SSH options require sshHost")
	}
	if c.DataDir == "" || !filepath.IsAbs(c.DataDir) || !filepath.IsAbs(c.CodexHome) {
		return errors.New("dataDir and codexHome must be absolute")
	}
	if c.IPCPath == "" {
		if runtime.GOOS == "windows" {
			c.IPCPath = `\\.\pipe\codex-ipc`
		} else {
			c.IPCPath = filepath.Join(c.CodexHome, "ipc", "ipc.sock")
		}
	}
	return nil
}
