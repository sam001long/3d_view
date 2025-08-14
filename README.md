# 3D 運鏡模擬器（GLB 上傳版） — GitHub Pages 自動部署

## 快速開始
1. 下載本專案並解壓，或直接 `git clone` 到你的電腦。
2. 本機測試：
   ```bash
   npm install
   npm run dev
   ```

## 一鍵部署到 GitHub Pages
1. 在 GitHub 建立一個空的 repo，推上去：
   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<你>/<repo>.git
   git push -u origin main
   ```
2. 這個 repo 已經包含 `.github/workflows/deploy.yml`。Push 之後，GitHub Actions 會：
   - 自動設定 Pages、計算 `VITE_BASE`（若 repo 名為 `xxx.github.io`，則基底為 `/`；否則為 `/<repo>/`）。
   - 建置 `dist/` 並部署到 Pages。
3. 完成後，在 repo 的 **Settings → Pages** 或 **Actions** workflow 頁面就能看到公開網址。

> 你的 GLB 與貼圖是「選檔即預覽」，只在瀏覽器端讀取，不會上傳到伺服器。

## 其他部署（Vercel / Netlify）
- 無需 `VITE_BASE`：直接 build 即可，輸出在 `dist/`。
