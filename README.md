# Wire Labyrinth (PWA / Offline)

## できること
- iOS/Androidのブラウザで動く、オフライン対応の一人称ワイヤーフレーム迷宮
- 30×30の固定マップ×4階層
- スワイプで方向転換（反転設定あり）、前進/後退はボタン
- ターン制、遠距離/近接、敵はチェビシェフ距離3で索敵＋命中で覚醒
- 宿/補給所は同一階で使うたびに値上がり
- 日英切替、BGM/SE ON/OFF

## 配置・バランスの編集（あなたが触る場所）
- `data/maps/f1.json`〜`f4.json` : 30×30マップ（外周は壁推奨）
- `data/entities.json` : 敵/宝箱/施設/階段/ゴール/トリガー/扉の配置
- `data/enemies.json` : 敵のステータス
- `data/weapons.json` : 遠距離武器（射程/MP/矢/命中補正など）
- `data/items.json` : アイテム
- `data/facilities.json` : 宿/補給所のコストと効果
- `data/i18n/ja.json`, `data/i18n/en.json` : 文言

## 実行方法
- ローカルで試すなら、簡易サーバを立ててください（PWAはfile://だと制限が出ます）
  - 例: `python -m http.server 8000`
  - ブラウザで `http://localhost:8000/` を開く

## デプロイ
- GitHub Pages / Cloudflare Pages 等の静的ホスティングでOKです。

## 注意
- iOSは音（WebAudio）がユーザー操作後にしか鳴らないため、「ニューゲーム」押下後にBGMが開始します。
