package control

import (
	"encoding/base64"
	"net/url"
	"strconv"
	"strings"

	"rsc.io/qr"
)

// 二维码只包含公开的 HTTPS 入口，账号、密码和设备令牌仍通过原登录流程处理。
func connectionQR(origin string) (string, string) {
	if len(origin) > 1024 {
		return "", ""
	}
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil ||
		u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(origin, "#") ||
		u.RawPath != "" || (u.Path != "" && u.Path != "/") {
		return "", ""
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return "", ""
		}
	}
	address := strings.TrimRight(origin, "/") + "/cxpalm/"
	code, err := qr.Encode(address, qr.M)
	if err != nil {
		return "", ""
	}
	return address, "data:image/png;base64," + base64.StdEncoding.EncodeToString(code.PNG())
}
