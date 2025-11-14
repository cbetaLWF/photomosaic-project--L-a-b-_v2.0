// ★ 変更点: 線画抽出（Sobel）のためのヘルパー関数
// (ピクセルデータ, 幅, 高さ) を受け取り、線画のピクセルデータを返す
function applySobelFilter(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    
    // 1. グレースケールに変換
    const grayscaleData = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        // 知覚輝度 (Luma)
        const gray = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        grayscaleData[i / 4] = gray;
    }

    const sobelData = new Uint8ClampedArray(data.length);
    const Gx = [
        [-1, 0, 1],
        [-2, 0, 2],
        [-1, 0, 1]
    ];
    const Gy = [
        [-1, -2, -1],
        [0, 0, 0],
        [1, 2, 1]
    ];

    // 2. Sobelフィルタ適用
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sumX = 0;
            let sumY = 0;

            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx));
                    const gray = grayscaleData[idx];
                    sumX += gray * Gx[ky + 1][kx + 1];
                    sumY += gray * Gy[ky + 1][kx + 1];
                }
            }

            const magnitude = Math.sqrt(sumX * sumX + sumY * sumY);
            // 0-255の範囲にクランプ
            const edgeValue = Math.min(255, magnitude); 

            // 線画を「黒」で描画 (255 - edgeValue)
            // 白背景(255)に黒い線(0)
            const finalValue = 255 - edgeValue;
            
            const i = (y * width + x) * 4;
            sobelData[i] = finalValue;
            sobelData[i + 1] = finalValue;
            sobelData[i + 2] = finalValue;
            sobelData[i + 3] = 255; // 不透明
        }
    }
    return new ImageData(sobelData, width, height);
}
// ★ ヘルパー関数ここまで


document.addEventListener('DOMContentLoaded', async () => {
    // UI要素の取得
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const tileSizeInput = document.getElementById('tile-size');
    
    // ★ 変更点: 両方のスライダーを取得
    const blendRangeInput = document.getElementById('blend-range');
    const blendValue = document.getElementById('blend-value');
    const edgeOpacityInput = document.getElementById('edge-opacity-range');
    const edgeOpacityValue = document.getElementById('edge-opacity-value');
    
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    const textureWeightInput = document.getElementById('texture-weight');
    const textureWeightValue = document.getElementById('texture-weight-value');
    
    // ( ... 必須要素チェック ... )
    if (!mainCanvas || !statusText || !generateButton) { /* ... */ }
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null;
    let mainImage = null;
    let workers = [];
    
    // ★ 変更点: 生成した線画を保持するCanvas
    let edgeCanvas = null;


    // --- UIの初期設定 ---
    generateButton.disabled = true;
    downloadButton.style.display = 'none';

    // ( ... スライダーのリスナー ... )
    if (brightnessCompensationInput && brightnessCompensationValue) { /* ... */ }
    if (textureWeightInput && textureWeightValue) { /* ... */ }
    // ★ 変更点: 両方のスライダーのリスナー
    if (blendRangeInput && blendValue) {
        blendRangeInput.addEventListener('input', () => {
            blendValue.textContent = blendRangeInput.value;
        });
    }
    if (edgeOpacityInput && edgeOpacityValue) {
        edgeOpacityInput.addEventListener('input', () => {
            edgeOpacityValue.textContent = edgeOpacityInput.value;
        });
    }

    // --- 1. タイルデータの初期ロード ---
    try {
        // ( ... 変更なし: JSONロードと6倍拡張(3x3)ベクトルのチェック ... )
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        if (!response.ok) { /* ... */ }
        tileData = await response.json();
        if (tileData.length === 0 || !tileData[0].patterns || tileData[0].patterns.length === 0 || !tileData[0].patterns[0].l_vector || tileData[0].patterns[0].l_vector.length !== 9) {
             throw new Error('tile_data.jsonが古いか 6倍拡張(3x3)ベクトルではありません。Analyzer Appで新しいデータを再生成してください。');
        }
        statusText.textContent = `ステータス: タイルデータ (${tileData.length}枚 / ${tileData.length * 6}パターン) ロード完了。メイン画像を選択してください。`;
        if (mainImageInput) mainImageInput.disabled = false;
    } catch (error) {
        statusText.textContent = `エラー: ${error.message}`;
        console.error("Initialization Error:", error);
        return;
    }
    
    // --- 2. メイン画像アップロード ---
    if (mainImageInput) {
        // ( ... 変更なし: 画像をロードしてプレビューするだけ ... )
        mainImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                mainImage = new Image();
                mainImage.onload = () => {
                    generateButton.disabled = false;
                    downloadButton.style.display = 'none';
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
    }

    // 起動中の全Workerを強制終了するヘルパー関数
    function terminateWorkers() {
        workers.forEach(w => w.terminate());
        workers = [];
    }

    // --- 3. モザイク生成開始 (並列化ロジック) ---
    generateButton.addEventListener('click', () => {
        if (!mainImage) return;
        
        terminateWorkers(); 
        generateButton.disabled = true;
        downloadButton.style.display = 'none';
        progressBar.style.width = '0%';
        statusText.textContent = 'ステータス: 画像データの準備中...';

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = mainImage.width;
        tempCanvas.height = mainImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(mainImage, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, mainImage.width, mainImage.height);

        // ★ 変更点: Worker処理の「前に」線画抽出を実行
        statusText.textContent = 'ステータス: メイン画像の線画を抽出中...';
        const edgeImageData = applySobelFilter(imageData);
        // 抽出した線画をオフスクリーンCanvasに保持
        edgeCanvas = new OffscreenCanvas(mainImage.width, mainImage.height);
        edgeCanvas.getContext('2d').putImageData(edgeImageData, 0, 0);
        // ★ 変更点ここまで

        const numWorkers = navigator.hardwareConcurrency || 4;
        statusText.textContent = `ステータス: ${numWorkers}コアを検出し、並列処理を開始...`;

        let finishedWorkers = 0;
        let allResults = [];
        
        // ( ... チャンク分けロジック (変更なし) ... )
        const tileSize = parseInt(tileSizeInput.value);
        const tileHeight = Math.round(tileSize * 1.0); 
        const alignedHeight = Math.ceil(mainImage.height / tileHeight) * tileHeight;
        const chunkHeight = Math.ceil(alignedHeight / numWorkers / tileHeight) * tileHeight;
        let startY = 0;
        let activeWorkers = 0; 
        
        for (let i = 0; i < numWorkers; i++) {
            const endY = Math.min(startY + chunkHeight, mainImage.height);
            if (startY >= endY) {
                continue; 
            }
            activeWorkers++; 
            const worker = new Worker('mosaic_worker.js');
            workers.push(worker);

            worker.onmessage = (e) => {
                // ( ... Workerからのメッセージ処理 (変更なし) ... )
                if (e.data.type === 'status') {
                    statusText.textContent = `ステータス (Worker ${i+1}): ${e.data.message}`;
                } else if (e.data.type === 'progress') {
                    const currentProgress = parseFloat(progressBar.style.width) || 0;
                    const newProgress = currentProgress + (e.data.progress * 100 / activeWorkers);
                    progressBar.style.width = `${newProgress}%`;
                } else if (e.data.type === 'complete') {
                    allResults = allResults.concat(e.data.results);
                    finishedWorkers++;
                    if (finishedWorkers === activeWorkers) {
                        statusText.textContent = 'ステータス: 全ワーカー処理完了。描画中...';
                        progressBar.style.width = '100%';
                        // ★ 変更点: renderMosaic に両方の値を渡す
                        renderMosaic(
                            allResults, 
                            mainImage.width, 
                            mainImage.height, 
                            parseInt(blendRangeInput.value), // ブレンド度
                            parseInt(edgeOpacityInput.value), // 線画の強さ
                            parseInt(brightnessCompensationInput.value)
                        );
                        terminateWorkers();
                    }
                }
            };
            worker.onerror = (error) => { /* ... (変更なし) ... */ };

            // Workerにデータを送信
            worker.postMessage({ 
                imageData: imageData, 
                tileData: tileData,
                tileSize: tileSize,
                width: mainImage.width,
                height: mainImage.height,
                // ★ 変更点: blendOpacityはWorkerに不要なので削除
                brightnessCompensation: parseInt(brightnessCompensationInput.value),
                textureWeight: parseFloat(textureWeightInput.value) / 100.0,
                startY: startY,
                endY: endY
            });
            startY += chunkHeight;
        }
        if (activeWorkers === 0) { /* ... (変更なし) ... */ }
    });

    // --- 4. 最終的なモザイクの描画 ---
    // (★ 変更点: 線画オーバーレイロジックを追加)
    async function renderMosaic(results, width, height, blendOpacity, edgeOpacity, brightnessCompensation) {
        statusText.textContent = 'ステータス: タイル画像を読み込み、描画中...';
        mainCanvas.width = width;
        mainCanvas.height = height;
        ctx.clearRect(0, 0, width, height);

        // クリッピング設定
        ctx.save(); 
        ctx.beginPath();
        ctx.rect(0, 0, width, height); 
        ctx.clip(); 

        let loadedCount = 0;
        const totalTiles = results.length;
        const promises = [];
        
        const MIN_TILE_L = 5.0; 
        const MAX_BRIGHTNESS_RATIO = 5.0; 
        const brightnessFactor = brightnessCompensation / 100; 

        for (const tile of results) {
            // ( ... 変更なし: タイルのロードと正方形クロップ/反転描画 ... )
            const p = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    let targetL = tile.targetL; 
                    let tileL = tile.tileL; 
                    if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
                    let brightnessRatio = targetL / tileL; 
                    if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
                        brightnessRatio = MAX_BRIGHTNESS_RATIO;
                    }
                    const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
                    ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;

                    const sWidth = img.naturalWidth;
                    const sHeight = img.naturalHeight;
                    const sSize = Math.min(sWidth, sHeight);
                    const isHorizontal = sWidth > sHeight; 
                    const typeParts = tile.patternType.split('_'); 
                    const cropType = typeParts[0]; 
                    const flipType = typeParts[1]; 
                    let sx = 0, sy = 0;
                    if (isHorizontal) {
                        if (cropType === "cropC") sx = Math.floor((sWidth - sSize) / 2);
                        else if (cropType === "cropR") sx = sWidth - sSize;
                    } else {
                        if (cropType === "cropM") sy = Math.floor((sHeight - sSize) / 2);
                        else if (cropType === "cropB") sy = sHeight - sSize;
                    }
                    const dx = tile.x, dy = tile.y;
                    const dWidth = tile.width, dHeight = tile.height; 

                    ctx.save();
                    if (flipType === "flip1") {
                        ctx.scale(-1, 1);
                        ctx.drawImage(img, sx, sy, sSize, sSize, -dx - dWidth, dy, dWidth, dHeight);
                    } else {
                        ctx.drawImage(img, sx, sy, sSize, sSize, dx, dy, dWidth, dHeight);
                    }
                    ctx.restore();
                    
                    ctx.filter = 'none';
                    loadedCount++;
                    resolve();
                };
                img.onerror = () => { /* ... (変更なし) ... */ resolve(); };
                img.src = tile.url; 
            });
            promises.push(p);
        }

        await Promise.all(promises);
        
        ctx.restore(); // クリッピングを解除

        progressBar.style.width = '100%';
        statusText.textContent = 'ステータス: タイル描画完了。ブレンド処理中...';

        // --- ★ 変更点: 2段階のブレンド処理 ---

        // 1. 従来の「陰影」ブレンド (Multiply)
        if (blendOpacity > 0) {
            ctx.globalCompositeOperation = 'multiply'; 
            ctx.globalAlpha = blendOpacity / 100;
            ctx.drawImage(mainImage, 0, 0, width, height);
        }

        // 2. 新しい「線画」ブレンド (Soft Light)
        if (edgeOpacity > 0 && edgeCanvas) {
            ctx.globalCompositeOperation = 'soft-light'; 
            ctx.globalAlpha = edgeOpacity / 100;
            ctx.drawImage(edgeCanvas, 0, 0, width, height);
        }
        
        // 3. 設定を元に戻す
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.globalAlpha = 1.0; 
        // ★ 変更点ここまで

        statusText.textContent = 'ステータス: モザイクアートが完成しました！';
        generateButton.disabled = false;
        downloadButton.style.display = 'block';
    }

    // --- 5. ダウンロード機能 (PNG形式) ---
    downloadButton.addEventListener('click', () => {
        // ( ... 変更なし ... )
    });
});
