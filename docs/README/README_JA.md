<div align="center">
  
  <img src="../../images/logo.png" width="400" alt="QueryGPT">
  
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
  [![Stars](https://img.shields.io/github/stars/MKY508/QueryGPT?style=for-the-badge&color=yellow)](https://github.com/MKY508/QueryGPT/stargazers)
  
  <br/>
  
  <h3>OpenInterpreter ベースのインテリジェントデータ分析エージェント</h3>
  <p><i>自然言語でデータベースと対話する</i></p>
  
</div>

<br/>

---

## ✨ コアアドバンテージ

**データアナリストのように思考する**
- **自律的探索**: 問題に遭遇した際、テーブル構造とサンプルデータを主体的に調査
- **多段階検証**: 異常を発見した場合、再検査により正確な結果を保証
- **複雑な分析**: SQLだけでなく、統計分析と機械学習のためのPython実行が可能
- **可視化された思考プロセス**: エージェントの推論過程をリアルタイムで表示（Chain-of-Thought）

## 🌟 主要機能

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
- **多言語対応**: 10言語をサポート（日本語、英語、中国語、韓国語、スペイン語、フランス語、ドイツ語、ロシア語、ポルトガル語、アラビア語）
- **マルチモデル対応**: GPT-5、Claude、Gemini、Ollamaローカルモデルを自由に切り替え
- **柔軟なデプロイメント**: クラウドAPIまたはOllamaローカルデプロイメントをサポート、データはローカルに保持
- **履歴記録**: 分析プロセスを保存、バックトラックと共有をサポート
- **データセキュリティ**: 読み取り専用権限、SQLインジェクション保護、機密データマスキング
- **柔軟なエクスポート**: Excel、PDF、HTML等の多様なフォーマットをサポート

## 📦 技術スタック

### バックエンド
- **Python 3.10.x** - コアランタイム環境（必須）
- **OpenInterpreter 0.4.3** - AIエージェントフレームワーク
- **Flask** - Webフレームワーク
- **MySQL/Doris** - データベースサポート

### フロントエンド
- **HTML5/CSS3** - モダンなWebインターフェース
- **JavaScript (ES6+)** - インタラクティブ機能
- **Chart.js/Plotly** - データ可視化
- **Responsive Design** - マルチデバイス対応

### AI/ML
- **OpenAI API** - GPTモデル統合
- **Claude API** - Anthropicモデルサポート
- **Ollama** - ローカルモデルデプロイメント
- **LangChain** - AIワークフロー管理

## 📸 システムスクリーンショット

<table>
  <tr>
    <td width="50%">
      <strong>🤖 インテリジェントAgent思考プロセス</strong><br/>
      <img src="../../images/agent-thinking-en.png" width="100%" alt="QueryGPT インターフェース"/>
      <p align="center">透明な思考チェーンの表示、AIがクエリをどのように分析するかを理解</p>
    </td>
    <td width="50%">
      <strong>📊 データ可視化</strong><br/>
      <img src="../../images/data-visualization-en.png" width="100%" alt="データ可視化"/>
      <p align="center">スマートチャート生成、最適な表示方法を自動選択</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>👨‍💻 開発者ビュー</strong><br/>
      <img src="../../images/developer-view-en.png" width="100%" alt="開発者ビュー"/>
      <p align="center">完全な実行詳細、SQLステートメントとコードが透明に表示</p>
    </td>
    <td width="50%">
      <strong>🌐 多言語サポート</strong><br/>
      <img src="../../images/main-interface.png" width="100%" alt="メインインターフェース"/>
      <p align="center">10言語をサポート、世界中のユーザーが利用可能</p>
    </td>
  </tr>
</table>

## 🚀 クイックスタート

### システム要件

- **Python**: 3.10.x（必須、OpenInterpreter 0.4.3の依存関係）
- **データベース**: MySQL 5.7+ または互換性のあるデータベース
- **メモリ**: 最小4GB RAM（推奨8GB以上）
- **ディスク**: 最小2GBの空き容量

### インストール手順

```bash
# 1. リポジトリをクローン
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# 2. セットアップスクリプトを実行（環境を自動設定）
./setup.sh

# 3. 環境変数を設定
cp .env.example .env
# .envファイルを編集し、API キーとデータベース接続情報を設定

# 4. サービスを起動
./start.sh
```

### 後続の使用

```bash
# クイックスタート
./quick_start.sh
```

サービスはデフォルトで http://localhost:5000 で実行されます

> **注意**: ポート5000が使用中の場合（macOSのAirPlayなど）、システムは自動的に次の利用可能なポート（5001-5010）を選択し、起動時に実際のポートを表示します。

## 💡 使用方法

### 基本的な使用例

1. **データ探索**
   ```
   「データベースにどのようなテーブルがありますか？」
   「売上テーブルの構造を見せてください」
   ```

2. **データクエリ**
   ```
   「先月の売上データを表示してください」
   「製品カテゴリ別の売上分析を行ってください」
   「売上上位10社の顧客を見つけてください」
   ```

3. **データ可視化**
   ```
   「月別売上推移のグラフを作成してください」
   「製品カテゴリの売上構成を円グラフで表示してください」
   「顧客分布のヒートマップを生成してください」
   ```

4. **高度な分析**
   ```
   「売上の季節性を分析してください」
   「顧客のRFM分析を実行してください」
   「来月の売上を予測してください」
   ```

### API使用

```python
import requests

# APIエンドポイント
url = "http://localhost:5000/api/chat"

# リクエストペイロード
payload = {
    "message": "先月の売上データを分析してください",
    "mode": "analysis",
    "stream": False
}

# APIリクエスト
response = requests.post(url, json=payload)
result = response.json()

print(result['response'])  # 分析結果
print(result['sql'])       # 生成されたSQL
print(result['visualization'])  # 可視化データ
```

## ⚙️ 設定

### 基本設定

1. **環境変数** (`.env`)
   ```env
   # OpenAI設定
   OPENAI_API_KEY=your_api_key_here
   OPENAI_BASE_URL=https://api.openai.com/v1
   
   # データベース接続
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=your_username
   DB_PASSWORD=your_password
   DB_NAME=your_database
   
   # システム設定
   DEFAULT_LANGUAGE=ja
   MAX_TOKENS=4096
   TEMPERATURE=0.7
   ```

2. **モデル設定** (`config/models.json`)
   ```json
   {
     "models": [
       {
         "name": "GPT-4",
         "id": "gpt-4",
         "api_base": "https://api.openai.com/v1",
         "api_key": "${OPENAI_API_KEY}"
       }
     ]
   }
   ```

3. **セマンティックレイヤー** (`backend/semantic_layer.json`)
   - ビジネス用語のマッピング
   - カスタムメトリクスの定義
   - データ関係の設定

## 📊 製品比較

| 比較項目 | **QueryGPT** | Vanna AI | DB-GPT | TableGPT | Text2SQL.AI |
|---------|:------------:|:--------:|:------:|:--------:|:-----------:|
| **コスト** | **✅ 無料** | ⭕ 有料版あり | ✅ 無料 | ❌ 有料 | ❌ 有料 |
| **オープンソース** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **ローカルデプロイ** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **Pythonコード実行** | **✅ 完全環境** | ❌ | ❌ | ❌ | ❌ |
| **可視化機能** | **✅ プログラマブル** | ⭕ プリセット | ✅ 豊富 | ✅ 豊富 | ⭕ 基本 |
| **多言語対応** | **✅ 10言語** | ⭕ 英語中心 | ⭕ 限定的 | ⭕ 限定的 | ⭕ 英語中心 |
| **エージェント自律探索** | **✅** | ❌ | ⭕ 基本 | ⭕ 基本 | ❌ |
| **リアルタイム思考表示** | **✅** | ❌ | ❌ | ❌ | ❌ |

### 差別化要因

- **完全なPython環境**: プリセット機能ではなく、真のPython実行環境
- **無限の拡張性**: 新機能が必要？新しいライブラリをインストールするだけ
- **エージェント自律探索**: 問題に遭遇すると主体的に調査
- **透明な思考プロセス**: AIの思考をリアルタイムで確認、いつでも介入可能
- **真の無料オープンソース**: MITライセンス、有料制限なし

## 🔒 セキュリティ

### データ保護
- **読み取り専用アクセス**: データベースへの書き込み権限なし
- **SQLインジェクション防止**: 厳格なクエリ検証
- **機密データマスキング**: 自動的に機密情報を検出してマスク
- **ローカル処理**: データはローカルに保持、外部送信なし

### アクセス制御
- **認証サポート**: JWT/OAuth2統合可能
- **ロールベースアクセス**: ユーザー権限管理
- **監査ログ**: すべてのクエリとアクセスを記録

## 🤝 コントリビューション

プロジェクトへの貢献を歓迎します！

1. リポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/AmazingFeature`)
3. 変更をコミット (`git commit -m 'Add some AmazingFeature'`)
4. ブランチにプッシュ (`git push origin feature/AmazingFeature`)
5. プルリクエストを開く

## 📝 ライセンス

このプロジェクトはMITライセンスの下で公開されています。詳細は[LICENSE](LICENSE)ファイルを参照してください。

## 📧 サポート

- **GitHub Issues**: [問題を報告](https://github.com/MKY508/QueryGPT/issues)
- **ドキュメント**: [詳細ドキュメント](docs/)
- **コミュニティ**: [ディスカッション](https://github.com/MKY508/QueryGPT/discussions)

## 🙏 謝辞

- [OpenInterpreter](https://github.com/OpenInterpreter/open-interpreter) - コアAIエージェントフレームワーク
- [Flask](https://flask.palletsprojects.com/) - Webフレームワーク
- [Chart.js](https://www.chartjs.org/) & [Plotly](https://plotly.com/) - データ可視化ライブラリ

---

<div align="center">
  <sub>AIの力でデータ分析を民主化する</sub>
  <br/>
  <sub>Made with ❤️ by the QueryGPT Team</sub>
</div>