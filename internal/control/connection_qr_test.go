package control

import (
	"bytes"
	"context"
	"encoding/base64"
	"image/png"
	"os"
	"strings"
	"testing"
)

func TestComputerQRCodeContainsOnlyPublicAddress(t *testing.T) {
	address, image := connectionQR("https://cxpalm.example.test")
	if address != "https://cxpalm.example.test/cxpalm/" {
		t.Fatal(address)
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(image, "data:image/png;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := png.Decode(bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
	// Android 解码同一张固定图片；这里防止服务端生成器变化后仍使用旧图片验收。
	sample, err := os.ReadFile("testdata/computer-qr.png")
	if err != nil || !bytes.Equal(data, sample) {
		t.Fatal("二维码与跨端解码样本不一致", err)
	}
	for _, origin := range []string{"https://host.test/", "https://host.test:9443", "https://[2001:db8::1]:9443"} {
		got, image := connectionQR(origin)
		if got != strings.TrimRight(origin, "/")+"/cxpalm/" || image == "" {
			t.Fatal(origin, got)
		}
	}
	for _, origin := range []string{"", "http://host.test", "https://user:secret@host.test", "https://host.test/?token=secret", "https://host.test/?", "https://host.test/#", "https://host.test/#pair=abc", "https://host.test/other", "https://host.test/%2f", "https://host.test:0", "https://host.test:65536", "https://" + strings.Repeat("x", 1024)} {
		if address, image := connectionQR(origin); address != "" || image != "" {
			t.Fatalf("二维码接受了无效入口 %q", origin)
		}
	}
	host := fixture(t)
	status, err := host.Execute(context.Background(), Request{Method: "status"})
	if err != nil {
		t.Fatal(err)
	}
	if status.(map[string]any)["connectionURL"] != "https://cx.example/cxpalm/" || status.(map[string]any)["connectionQRCode"] == "" {
		t.Fatal("状态接口缺少二维码")
	}
}
