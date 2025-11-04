<div align="center">
  
  <img src="../images/logo.png" width="400" alt="QueryGPT">
  
  <br/>
  
  <p>
    <a href="README.md">English</a> •
    <a href="docs/README_CN.md">简体中文</a> •
    <a href="#">日本語</a>
  </p>
  
  <br/>
  
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.10+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![OpenInterpreter](https://img.shields.io/badge/OpenInterpreter-0.4.3-green.svg?style=for-the-badge)](https://github.com/OpenInterpreter/open-interpreter)
  [![Stars](https://img.shields.io/badge/Stars-MKY508/QueryGPT-yellow.svg?style=for-the-badge&color=yellow)](https://github.com/MKY508/QueryGPT/stargazers)
  
  <br/>
  
  <h3>OpenInterpreter ベースのインテリジェントデータ分析エージェント</h3>
  <p><i>自然言語でデータベースと対話する</i></p>
  
</div>

## ✨ コアアドバンテージ

**データアナリストのように思考する**
- **自律的探索**: 問題に遭遇した際、テーブル構造とサンプルデータを主体的に調査
- **多段階検証**: 異常を発見した場合、再検査により正確な結果を保証
- **複雑な分析**: SQLだけでなく、統計分析と機械学習のためのPython実行が可能
- **可視化された思考プロセス**: エージェントの推論過程をリアルタイムで表示（Chain-of-Thought）

## 📸 システムスクリーンショット

<img src="../images/agent-thinking-en.png" width="100%" alt="QueryGPT インターフェース"/>

**AIの思考プロセスをリアルタイムで表示、日本語での会話で複雑なデータ分析を完了。**

---

<img src="../images/data-visualization-en.png" width="100%" alt="データ可視化"/>

**インタラクティブなグラフの自動生成、データインサイトが一目で分かる。**

---

<img src="../images/developer-view-en.png" width="100%" alt="開発者ビュー"/>

**完全に透明なコード実行、SQLとPythonのデュアルエンジンをサポート。**

## 🌟 機能特性

### エージェントコア機能
- **自律的データ探索**: エージェントが主体的にデータ構造を理解し、データ関係を探索
- **多段階推論**: アナリストのように、問題を発見した際に深く調査
- **Chain-of-Thought**: エージェントの思考プロセスをリアルタイム表示、いつでも介入可能
- **コンテキストメモリー**: 対話履歴を理解し、継続的な多段階分析をサポート

### データ分析機能
- **SQL + Python**: SQLに限定されず、複雑なPythonデータ処理を実行可能
- **統計分析**: 相関分析、トレンド予測、異常検出を自動実行
- **ビジネス用語理解**: 前年比、前月比、リテンション、リピート購入などの概念をネイティブに理解
- **スマート可視化**: データ特性に基づいて最適なチャートタイプを自動選択

### システム特性
- **マルチモデル対応**: GPT-5、Claude、Gemini、Ollamaローカルモデルを自由に切り替え
- **柔軟なデプロイメント**: クラウドAPIまたはOllamaローカルデプロイメントをサポート、データはローカルに保持
- **履歴記録**: 分析プロセスを保存、バックトラックと共有をサポート
- **データセキュリティ**: 読み取り専用権限、SQLインジェクション保護、機密データマスキング
- **柔軟なエクスポート**: Excel、PDF、HTML等の多様なフォーマットをサポート

## 📦 技術要件

- Python 3.10.x（必須、OpenInterpreter 0.4.3の依存関係）
- MySQLまたは互換データベース

> Windows：WSL内で実行してください（PowerShell/CMDから直接実行しないでください）。

## 📊 製品比較

| 比較次元 | **QueryGPT** | Vanna AI | DB-GPT | TableGPT | Text2SQL.AI |
|---------|:------------:|:--------:|:------:|:--------:|:-----------:|
| **費用** | **✅ 無料** | ⭕ 有料版あり | ✅ 無料 | ❌ 有料 | ❌ 有料 |
| **オープンソース** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **ローカルデプロイ** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **Pythonコード実行** | **✅ 完全環境** | ❌ | ❌ | ❌ | ❌ |
| **可視化機能** | **✅ プログラマブル** | ⭕ プリセットチャート | ✅ 豊富なチャート | ✅ 豊富なチャート | ⭕ 基本 |
| **ビジネス用語理解** | **✅ ネイティブ** | ⭕ 基本 | ✅ 良好 | ✅ 優秀 | ⭕ 基本 |
| **エージェント自律探索** | **✅** | ❌ | ⭕ 基本 | ⭕ 基本 | ❌ |
| **リアルタイム思考表示** | **✅** | ❌ | ❌ | ❌ | ❌ |
| **拡張機能** | **✅ 無制限拡張** | ❌ | ❌ | ❌ | ❌ |

### 当社のコア差別化
- **完全なPython環境**: プリセット機能ではなく、真のPython実行環境、あらゆるコードを記述可能
- **無制限の拡張性**: 新機能が必要？新しいライブラリを直接インストール、製品の更新を待つ必要なし
- **エージェント自律探索**: 問題に遭遇すると主体的に調査、単純な一回限りのクエリではない
- **透明な思考プロセス**: AIが何を考えているかリアルタイムで確認、いつでも介入して指導可能
- **真の無料オープンソース**: MITライセンス、有料の壁なし

## 🚀 クイックスタート

### 初回使用

```bash
# 1. プロジェクトをクローン
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# 2. インストールスクリプトを実行（環境を自動設定）
./setup.sh

# 3. サービスを起動
./start.sh
```

### 後続の使用

```bash
# 直接起動（環境がインストール済み）
./start.sh
```

サービスはデフォルトで http://localhost:5000 で実行されます

> **注意**: ポート5000が使用中の場合（macOSのAirPlayなど）、システムは自動的に次の利用可能なポート（5001-5010）を選択し、起動時に実際のポートを表示します。

## ⚙️ 設定説明

### 基本設定

1. **環境設定ファイルをコピー**
   ```bash
   cp .env.example .env
   ```

2. **以下の内容を設定するために.envファイルを編集**
   - `OPENAI_API_KEY`: あなたのOpenAI APIキー
   - `OPENAI_BASE_URL`: APIエンドポイント（オプション、デフォルトは公式エンドポイントを使用）
   - データベース接続情報

### セマンティックレイヤー設定（オプション）

セマンティックレイヤーはビジネス用語の理解を強化し、システムがあなたのビジネス言語をより良く理解できるようにします。**これはオプション設定で、設定しなくても基本機能に影響しません。**

1. **サンプルファイルをコピー**
   ```bash
   cp backend/semantic_layer.json.example backend/semantic_layer.json
   ```

2. **あなたのビジネスニーズに応じて設定を変更**
   
   セマンティックレイヤー設定には3つの部分が含まれます：
   - **データベースマッピング**: データベースのビジネス意味を定義
   - **コアビジネステーブル**: 重要なビジネステーブルとフィールドをマッピング
   - **高速検索インデックス**: 一般的な用語の高速検索

3. **設定例**
   ```json
   {
     "コアビジネステーブル": {
       "注文管理": {
         "テーブルパス": "database.orders",
         "キーワード": ["注文", "販売", "取引"],
         "必須フィールド": {
           "order_id": "注文番号",
           "amount": "金額"
         }
       }
     }
   }
   ```

> **説明**: 
> - セマンティックレイヤーファイルにはビジネス機密情報が含まれており、`.gitignore`に追加されています。バージョン管理に送信されません
> - セマンティックレイヤーを設定しない場合、システムはデフォルト設定を使用し、データクエリを正常に実行できます
> - 詳細な設定説明については、[backend/SEMANTIC_LAYER_SETUP.md](backend/SEMANTIC_LAYER_SETUP.md)を参照してください

## 📁 プロジェクト構造

```
QueryGPT/
├── backend/              # バックエンドサービス
│   ├── app.py           # Flaskアプリケーションのメインエントリーポイント
│   ├── database.py      # データベース接続管理
│   ├── interpreter_manager.py  # クエリインタープリター
│   ├── history_manager.py      # 履歴管理
│   └── config_loader.py        # 設定ローダー
├── frontend/            # フロントエンドインターフェース
│   ├── templates/       # HTMLテンプレート
│   └── static/          # 静的リソース
│       ├── css/         # スタイルファイル
│       └── js/          # JavaScript
├── docs/                # プロジェクトドキュメント
├── logs/                # ログディレクトリ
├── output/              # 出力ファイル
├── requirements.txt     # Python依存関係
└── .env.example         # 設定例
```

## 🔌 APIインターフェース

### クエリインターフェース

```http
POST /api/chat
Content-Type: application/json

{
  "message": "今月の売上合計をクエリ",
  "model": "default"
}
```

### 履歴

```http
GET /api/history/conversations    # 履歴リストを取得
GET /api/history/conversation/:id # 詳細を取得
DELETE /api/history/conversation/:id # レコードを削除
```

### ヘルスチェック

```http
GET /api/health
```

## 🔒 セキュリティ説明

- 読み取り専用クエリのみサポート（SELECT, SHOW, DESCRIBE）
- 危険なSQLステートメントを自動フィルタリング
- データベースユーザーは読み取り専用権限で設定する必要があります

## 📄 ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照

## 🆕 最新の更新

- 2025-09-05 – 起動速度の最適化：初回モデルページ入場時の自動バッチテストを削除し、不要なリクエストを削減し、状態の誤書き込みを回避。

## 👨‍💻 作成者

- **作成者**: Mao Kaiyue
- **GitHub**: [@MKY508](https://github.com/MKY508)
- **作成日**: 2025年8月

## ⭐ Star History

<div align="center">
  <a href="https://star-history.com/#MKY508/QueryGPT&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
    </picture>
  </a>
</div>

## 🤝 貢献

IssuesとPull Requestの提出を歓迎します。

1. このプロジェクトをFork
2. 機能ブランチを作成 (`git checkout -b feature/AmazingFeature`)
3. 変更をコミット (`git commit -m 'Add some AmazingFeature'`)
4. ブランチにプッシュ (`git push origin feature/AmazingFeature`)
5. Pull Requestを提出
