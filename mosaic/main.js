document.addEventListener('DOMContentLoaded', async () => {
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    
    // UIコントロール
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const brightnessCompInput = document.getElementById('brightness-comp');
    
    // UI値表示の更新
    document.getElementById('tile-size-value').textContent = tileSizeInput.value;
    document.getElementById('blend-range-value').textContent = blendRangeInput.value;
    document.getElementById('brightness-comp-value').textContent = brightnessCompInput.value;

    tileSizeInput.addEventListener('input', (e) => document.getElementById('tile-size-value').textContent = e.target.value);
    blendRangeInput.addEventListener('input', (e) => document.getElementById('blend-range-value').textContent = e.target.value);
    brightnessCompInput.addEventListener('input', (e) => document.getElementById('brightness-comp-value').textContent = e.target.value);


    let tileData = null;
    let mainImage = null;
    let currentResults = null; // 最新のモザイク結果を保持

    // --- 1. タイルデータの初期ロード ---
    try {
        const response = await fetch('tile_data.json');
        if (!response.ok) {
            throw new Error('tile_data.json のロードに失敗しました。ファイルが /mosaic/ に配置されているか確認してください。');
        }
        tileData = await response.json();
        statusText.textContent = `ステータス: タイルデータ (${tileData.length}枚分) ロード完了。メイン画像を選択してください。`;
    } catch (error) {
        statusText.textContent = `致命的エラー: ${error.message}`;
        return;
    }
    
    // --- 2. メイン画像アップロード ---
    mainImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            mainImage = new Image();
            mainImage.onload = () => {
                generateButton.disabled = false;
                mainCanvas.width = mainImage.width;
                mainCanvas.height = mainImage.height;
                ctx.clearRect(0, 0, mainImage.width, mainImage.height);
                ctx.drawImage(mainImage, 0, 0); // プレビュー表示
                statusText.textContent = `ステータス: 画像ロード完了 (${mainImage.width}x${mainImage.height})。生成ボタンを押してください。`;
            };
            mainImage.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    // --- 3. モザイク生成開始 ---
    generateButton.addEventListener('click', () => {
        if (!mainImage) return;
        
        generateButton.disabled = true;
        downloadButton.style.display = 'none';
        progressBar.style.width = '0%';
        statusText.textContent = 'ステータス: 画像データの準備中...';

        // メイン画像のピクセルデータを取得
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = mainImage.width;
        tempCanvas.height = mainImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(mainImage, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, mainImage.width, mainImage.height);

        // Workerを起動
        const worker = new Worker('mosaic_worker.js');

        // Workerにデータを送信
        worker.postMessage({ 
            imageData: imageData, 
            tileData: tileData, 
            tileSize: parseInt(tileSizeInput.value),
            width: mainImage.width,
            height: mainImage.height,
            blendOpacity: parseInt(blendRangeInput.value) / 100,
            brightnessCompensation: parseInt(brightnessCompInput.value) / 100
        });

        // Workerからのメッセージ受信
        worker.onmessage = (e) => {
            if (e.data.type === 'status') {
                statusText.textContent = `ステータス: ${e.data.message}`;
            } else if (e.data.type === 'progress') {
                const progress = Math.round(e.data.progress * 100 * 0.9); // マッチングは全体の90%
                progressBar.style.width = `${progress}%`;
            } else if (e.data.type === 'complete') {
                currentResults = e.data; // 結果を保存
                renderMosaic(e.data); // 描画処理を実行
                worker.terminate();
            }
        };

        worker.onerror = (error) => {
            statusText.textContent = `エラー: Worker処理中に問題が発生しました。 ${error.message}`;
            generateButton.disabled = false;
            worker.terminate();
        };
    });

    // --- 4. 最終的なモザイクの描画 ---
    async function renderMosaic(data) {
        const { results, width, height, blendOpacity, brightnessCompensation } = data;

        statusText.textContent = 'ステータス: タイル画像をロードし、明度補正を適用して描画中...';
        mainCanvas.width = width;
        mainCanvas.height = height;
        ctx.clearRect(0, 0, width, height);
        
        // 描画の準備
        let loadedCount = 0;
        const totalTiles = results.length;
        const matchingProgress = 90; // マッチングは90%で完了済み

        // --- 明度補正のための定数を定義 ---
        const MIN_TILE_L = 5.0; // タイルのL*値の最小フロア (0に近いタイルによる不安定性を回避)
        const MAX_BRIGHTNESS_RATIO = 3.0; // 明度補正の最大倍率 (極端な明るさで描画が崩れるのを防ぐ)


        // 描画に必要なタイル画像を非同期でロードし、描画する
        const renderPromises = results.map(tile => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous'; 

                img.onload = () => {
                    // ★ L*a*b*明度補正の計算と適用 ★
                    
                    // 1. タイルのL*値に最小フロアを適用
                    const safeTileL = Math.max(tile.tileL, MIN_TILE_L);
                    
                    // 2. ターゲットL*と安全なタイルL*から基本補正倍率を算出
                    let compensationRatio = tile.targetL / safeTileL;

                    // 3. 基本倍率を安全な範囲にクランプ（制限）
                    compensationRatio = Math.min(compensationRatio, MAX_BRIGHTNESS_RATIO);
                    compensationRatio = Math.max(compensationRatio, 0.2); // 過度な暗さも防止

                    // 4. ユーザー設定の強度で補正を調整 (1.0が元の明るさ)
                    const finalBrightness = 1.0 + (compensationRatio - 1.0) * brightnessCompensation;
                    
                    // 5. CSSフィルターをCanvasに適用
                    ctx.filter = `brightness(${finalBrightness})`;

                    // 描画 (高解像度のタイルを縮小して描画)
                    ctx.drawImage(img, tile.x, tile.y, tile.width, tile.height);
                    
                    // 6. フィルターをリセット (次のタイルに影響を与えないように)
                    ctx.filter = 'none';

                    loadedCount++;
                    // 進捗バーを更新 (マッチングの90%から開始)
                    const totalProgress = matchingProgress + Math.round((loadedCount / totalTiles) * 10); 
                    progressBar.style.width = `${totalProgress}%`;
                    
                    resolve();
                };
                img.onerror = () => {
                    console.error(`タイル画像のロードに失敗: ${tile.url}`);
                    // 失敗した場所を代替色で塗りつぶす (デバッグ用)
                    ctx.fillStyle = `rgba(${tile.r}, ${tile.g}, ${tile.b}, 0.5)`;
                    ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
                    loadedCount++;
                    const totalProgress = matchingProgress + Math.round((loadedCount / totalTiles) * 10); 
                    progressBar.style.width = `${totalProgress}%`;
                    resolve(); 
                };
                img.src = tile.url; 
            });
        });

        // すべてのタイルが描画された後、ブレンド処理を実行
        Promise.all(renderPromises).then(() => {
            applyBlend(width, height, blendOpacity); // ブレンド処理を実行
            
            statusText.textContent = 'ステータス: モザイクアートが完成しました！';
            generateButton.disabled = false;
            downloadButton.style.display = 'block';
            progressBar.style.width = '100%';
        });
    }

    // --- 5. ブレンド処理の関数化 ---
    function applyBlend(width, height, opacity) {
        if (opacity > 0) {
            // 元の画像を半透明で重ねるブレンド処理
            ctx.globalAlpha = opacity;
            ctx.drawImage(mainImage, 0, 0, width, height);
            ctx.globalAlpha = 1.0; // 元に戻す
        }
    }

    // --- 6. ダウンロード機能 ---
    downloadButton.addEventListener('click', () => {
        // JPEG形式、品質90%でエクスポート
        const dataURL = mainCanvas.toDataURL('image/jpeg', 0.9); 
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `photomosaic-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
});
