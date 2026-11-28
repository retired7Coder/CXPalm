// Package control exposes a bounded local desktop protocol over inherited pipes.
// It has no listener, arbitrary RPC, shell command or connection-config writer.
package control

import (
	"bufio"
	"context"
	"cxpalm/internal/agent"
	"cxpalm/internal/config"
	"cxpalm/internal/desktop"
	"cxpalm/internal/store"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strings"
	"time"
)

type Request struct {
	ID     string            `json:"id"`
	Method string            `json:"method"`
	Device string            `json:"device,omitempty"`
	Login  *store.LoginInput `json:"login,omitempty"`
	Policy *store.IPPolicy   `json:"policy,omitempty"`
}
type Response struct {
	ID    string `json:"id"`
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}
type Host struct {
	config           config.Config
	db               *store.Store
	runtime          *agent.Runtime
	desktopOK        *bool
	diagnosedAt      int64
	connectionURL    string
	connectionQRCode string
}

func New(c config.Config, db *store.Store) *Host {
	address, image := connectionQR(c.Origin)
	return &Host{config: c, db: db, connectionURL: address, connectionQRCode: image}
}
func (h *Host) Close() {
	if h.runtime != nil {
		h.runtime.Stop()
		h.runtime = nil
		h.desktopOK = nil
		h.diagnosedAt = 0
	}
}
func (h *Host) owned() bool {
	if h.runtime == nil {
		return false
	}
	select {
	case <-h.runtime.Done:
		h.runtime.Stop()
		h.runtime = nil
		h.desktopOK = nil
		h.diagnosedAt = 0
		return false
	default:
		return true
	}
}
func (h *Host) status(ctx context.Context) (any, error) {
	state := "stopped"
	if h.owned() {
		state = "running"
	} else {
		conn, err := net.DialTimeout("tcp", h.config.Listen, 200*time.Millisecond)
		if err == nil {
			state = "occupied"
			conn.Close()
		}
	}
	counts := map[string]any{}
	history := desktop.History{Config: h.config}
	for _, a := range []bool{false, true} {
		count := 0
		for {
			rows, err := history.ListPage(ctx, "", a, 500, count)
			if err != nil {
				counts["error"] = "Cannot read Codex history; open the official desktop and retry"
				break
			}
			count += len(rows)
			if len(rows) < 500 {
				break
			}
			if ctx.Err() != nil {
				counts["error"] = "History count timed out"
				break
			}
		}
		if a {
			counts["archived"] = count
		} else {
			counts["active"] = count
		}
	}
	devices, err := h.db.Devices()
	if err != nil {
		return nil, err
	}
	active := 0
	for _, d := range devices {
		if !d.Revoked && d.Expires > time.Now().Unix() {
			active++
		}
	}
	return map[string]any{"version": config.Version, "state": state, "owned": state == "running", "origin": h.config.Origin, "connectionURL": h.connectionURL, "connectionQRCode": h.connectionQRCode, "listen": h.config.Listen, "codexHome": h.config.CodexHome, "sshConfigured": h.config.SSHHost != "", "desktopConnected": h.desktopOK, "diagnosedAt": h.diagnosedAt, "sessions": counts, "devices": active, "trustedProxyIP": h.config.TrustedProxyIP}, nil
}
func (h *Host) Execute(ctx context.Context, q Request) (any, error) {
	if q.Login != nil && q.Method != "login.set" {
		return nil, errors.New("Login is valid only for login.set")
	}
	if q.Policy != nil && q.Method != "ip-policy.set" {
		return nil, errors.New("Policy is valid only for ip-policy.set")
	}
	if q.Device != "" && q.Method != "devices.revoke" {
		return nil, errors.New("Device is valid only for devices.revoke")
	}
	switch q.Method {
	case "status":
		return h.status(ctx)
	case "start":
		if !h.owned() {
			r, err := agent.Start(context.Background(), h.config, h.db)
			if err != nil {
				return nil, err
			}
			h.runtime = r
			h.desktopOK = nil
			h.diagnosedAt = 0
		}
		return h.status(ctx)
	case "stop":
		if h.runtime == nil {
			return nil, errors.New("No Agent owned by this window; external processes are never stopped")
		}
		h.runtime.Stop()
		h.runtime = nil
		h.desktopOK = nil
		h.diagnosedAt = 0
		return h.status(ctx)
	case "login.get":
		return h.db.LoginSettings()
	case "login.set":
		if q.Login == nil {
			return nil, errors.New("Login settings are required")
		}
		return h.db.SetLogin(*q.Login)
	case "device.logs":
		return h.db.DeviceEvents()
	case "ip-policy.get":
		return h.db.IPPolicy()
	case "ip-policy.set":
		if q.Policy == nil {
			return nil, errors.New("IP policy is required")
		}
		if q.Policy.Enabled {
			if h.config.SSHHost != "" && !h.config.TrustedProxyIP {
				return nil, errors.New("Trusted proxy IP forwarding is not configured")
			}
			if !h.owned() {
				if conn, err := net.DialTimeout("tcp", h.config.Listen, 200*time.Millisecond); err == nil {
					conn.Close()
					return nil, errors.New("Cannot enable IP policy for an external Agent; start the updated Agent from this window first")
				}
			}
		}
		return h.db.SetIPPolicy(*q.Policy)
	case "devices":
		return h.db.Devices()
	case "devices.revoke":
		if len(q.Device) != 32 || strings.Trim(q.Device, "0123456789abcdef") != "" {
			return nil, errors.New("Invalid device ID")
		}
		if err := h.db.Revoke(q.Device); err != nil {
			return nil, err
		}
		return h.db.Devices()
	case "diagnose":
		conn, err := desktop.Connect(ctx, h.config.IPCPath)
		ok := err == nil
		h.desktopOK = &ok
		h.diagnosedAt = time.Now().UnixMilli()
		if conn != nil {
			conn.Close()
		}
		return h.status(ctx)
	case "shutdown":
		h.Close()
		return map[string]bool{"closed": true}, nil
	default:
		return nil, errors.New("Unsupported desktop operation")
	}
}
func Serve(ctx context.Context, input io.Reader, output io.Writer, h *Host) error {
	defer h.Close()
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	enc := json.NewEncoder(output)
	for scanner.Scan() {
		var q Request
		decoder := json.NewDecoder(strings.NewReader(scanner.Text()))
		decoder.DisallowUnknownFields()
		err := decoder.Decode(&q)
		var extra any
		if err == nil && decoder.Decode(&extra) != io.EOF {
			err = errors.New("one command per line required")
		}
		if err != nil || q.ID == "" || len(q.ID) > 80 {
			if e := enc.Encode(Response{Error: "Invalid desktop request"}); e != nil {
				return e
			}
			continue
		}
		call, cancel := context.WithTimeout(ctx, 6*time.Second)
		data, err := h.Execute(call, q)
		cancel()
		response := Response{ID: q.ID, Data: data}
		if err != nil {
			response.Data = nil
			response.Error = err.Error()
		}
		if err = enc.Encode(response); err != nil {
			return err
		}
		if q.Method == "shutdown" {
			return nil
		}
	}
	return scanner.Err()
}
