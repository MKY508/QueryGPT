## 安装说明 / Installation

本次构建需要 macOS 13 或更高版本，或 64 位 Windows 10/11。
This build requires macOS 13 or later, or 64-bit Windows 10/11.

打开 DMG 后，将 ReceiptBI 拖入“应用程序”文件夹。

若系统阻止首次打开未签名的 macOS 构建，请在终端运行：

After opening the DMG, move ReceiptBI to Applications. If macOS blocks the first launch of the unsigned build, run:

```bash
xattr -cr /Applications/ReceiptBI.app
```

Windows 用户直接运行 `.exe` 安装程序即可。On Windows, run the `.exe` installer.
