// 線画抽出（Sobel）のためのヘルパー関数
function applySobelFilter(imageData) {
    // ( ... 変更なし: 前回の「黒い線 + 透明な背景」版の SobelFilter ... )
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const grayscaleData = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        grayscaleData[i / 4] = gray;
    }
    const finalSobelData = new Uint8ClampedArray(data.length);
    const Gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const Gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
    const thresholds = { low: 15, med: 30, high: 80 };
    const detailVector = { low: 0, med: 0, high: 0 };
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sumX = 0, sumY = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx));
                    if (idx < 0 || idx >= grayscaleData.length) continue; 
                    const gray = grayscaleData[idx];
                    sumX += gray * Gx[ky + 1][kx + 1];
                    sumY += gray * Gy[ky + 1][kx + 1];
                }
            }
            const magnitude = Math.sqrt(sumX * sumX + sumY * sumY);
            const i = (y * width + x) * 4;
            if (magnitude > thresholds.med) {
                const alpha = Math.min(255, magnitude * 1.5);
                finalSobelData[i] = 0; finalSobelData[i + 1] = 0; finalSobelData[i + 2] = 0;
                finalSobelData[i + 3] = alpha; 
                detailVector.med += alpha; 
            }
            if (magnitude > thresholds.low) { detailVector.low += magnitude; }
            if (magnitude > thresholds.high) { detailVector.high += magnitude; }
        }
    }
    return { 
        finalEdgeImageData: new ImageData(finalSobelData, width, height), 
        detailVector: detailVector
    };
}
// ★ ヘルパー関数ここまで


// 画像を分析し、推奨値を返すヘルパー関数
function analyzeImageAndGetRecommendations(image, analysisImageData) {
    // ( ... 変更なし: 複数閾値でのディテール評価 ... )
    const width = image.width;
    const height = image.height;
    const data = analysisImageData.data; 
    let sumLuma = 0;
    for (let i = 0; i < data.length; i += 4) {
        const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        sumLuma += luma;
    }
    const pixelCount = data.length / 4;
    const meanLuma = sumLuma / pixelCount; 
    const edgeResult = applySobelFilter(analysisImageData); 
    const detailVector = edgeResult.detailVector; 
    const detailLow = (detailVector.low / pixelCount) || 0;   
    const detailHigh = (detailVector.high / pixelCount) || 0; 
    const recommendations = {};
    if (width > 3000) recommendations.tileSize = 15;
    else if (width > 1500) recommendations.tileSize = 25;
    else recommendations.tileSize = 30;
    recommendations.brightnessCompensation = 100;
    recommendations.textureWeight = Math.round(Math.min(200, detailLow * 3.0 + 30)); 
    recommendations.blendRange = Math.round(Math.max(10, meanLuma / 7.0)); 
    recommendations.edgeOpacity = Math.round(Math.max(10, 60 - detailHigh * 10.0));
    return recommendations;
}
// ★ ヘルパー関数ここまで


document.addEventListener('DOMContentLoaded', async () => {
    // --- UI要素の取得 ---
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    
    // スライダー本体
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const edgeOpacityInput = document.getElementById('edge-opacity-range');
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const textureWeightInput = document.getElementById('texture-weight');
    
    // スライダーの値表示
    const blendValue = document.getElementById('blend-value');
    const edgeOpacityValue = document.getElementById('edge-opacity-value');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    const textureWeightValue = document.getElementById('texture-weight-value');
    
    // 推奨値エリアのUI
    const recommendationArea = document.getElementById('recommendation-area');
    const applyRecommendationsButton = document.getElementById('apply-recommendations-button');
    const recTileSize = document.getElementById('rec-tile-size');
    const recBrightness = document.getElementById('rec-brightness');
    const recTextureWeight = document.getElementById('rec-texture-weight');
    const recBlendRange = document.getElementById('rec-blend-range');
    const recEdgeOpacity = document.getElementById('rec-edge-opacity');

    // ★ 変更点: プレビューチェックボックス
    const previewModeCheckbox = document.getElementById('preview-mode-checkbox');

    
    // ★ 変更点: 必須要素チェックに previewModeCheckbox を追加
    if (!mainCanvas || !statusText || !generateButton || !mainImageInput || !tileSizeInput || !previewModeCheckbox) {
        console.error("Initialization Error: One or more critical HTML elements are missing.");
        document.body.innerHTML = "<h1>Initialization Error</h1><p>The application failed to load because critical elements (Canvas, Buttons, Status, Sliders) are missing from the HTML.</p>";
        return;
    }
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null;
    let mainImage = null;
    let workers = [];
    let edgeCanvas = null; 
    let currentRecommendations = null;

    // キャッシュ機能のための変数
    let cachedResults = null; 
    let lastHeavyParams = {}; 

    // ★ 変更点: 高速化のための新しいグローバル変数
    let isPreviewRender = true; // 最後の描画がプレビューモードだったか
    let isGeneratingFullRes = false; // 高画質版を生成中か


    // --- UIの初期設定 ---
    // ( ... 変更なし: スライダーリスナー ... )
    generateButton.disabled = true;
    downloadButton.style.display = 'none';
    if (brightnessCompensationInput && brightnessCompensationValue) { /* ... */ }
    if (textureWeightInput && textureWeightValue) { /* ... */ }
    if (blendRangeInput && blendValue) { /* ... */ }
    if (edgeOpacityInput && edgeOpacityValue) { /* ... */ }

    // --- 1. タイルデータの初期ロード ---
    try {
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        if (!response.ok) { throw new Error(`tile_data.json のロードに失敗しました (HTTP ${response.status})。`); }
        tileData = await response.json();
        
        // ★ 変更点: thumb_url の存在チェック
        if (tileData.length === 0 || !tileData[0].patterns || tileData[0].patterns.length === 0 || !tileData[0].patterns[0].l_vector || tileData[0].patterns[0].l_vector.length !== 9 || !tileData[0].thumb_url) {
             throw new Error('tile_data.jsonが古いか 6倍拡張(3x3)ベクトル/thumb_urlではありません。Analyzer Appで新しいデータを再生成してください。');
        }
        
        statusText.textContent = `ステータス: タイルデータ (${tileData.length}枚 / ${tileData.length * (tileData[0].patterns ? tileData[0].patterns.length : 0)}パターン) ロード完了。メイン画像を選択してください。`;
        if (mainImageInput) mainImageInput.disabled = false;
    } catch (error) {
        statusText.textContent = `エラー: ${error.message}`;
        console.error("Initialization Error:", error);
        return;
    }
    
    // --- 2. メイン画像アップロード ---
    if (mainImageInput) {
        // ( ... 変更なし: 推奨値計算、線画事前計算 ... )
        mainImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                mainImage = new Image();
                mainImage.onload = () => {
                    cachedResults = null;
                    lastHeavyParams = {};
                    generateButton.disabled = false;
                    downloadButton.style.display = 'none';
                    mainCanvas.width = mainImage.width;
                    mainCanvas.height = mainImage.height;
                    ctx.clearRect(0, 0, mainImage.width, mainImage.height);
                    ctx.drawImage(mainImage, 0, 0); 
                    statusText.textContent = `ステータス: 画像ロード完了。推奨値を計算中...`;

                    try {
                        const analysisSize = 400; 
                        const ratio = analysisSize / Math.max(mainImage.width, mainImage.height);
                        const w = mainImage.width * ratio;
                        const h = mainImage.height * ratio;
                        const analysisCanvas = new OffscreenCanvas(w, h);
                        const analysisCtx = analysisCanvas.getContext('2d');
                        analysisCtx.drawImage(mainImage, 0, 0, w, h);
                        const analysisImageData = analysisCtx.getImageData(0, 0, w, h);
                        const recommendations = analyzeImageAndGetRecommendations(mainImage, analysisImageData);
                        currentRecommendations = recommendations; 
                        
                        statusText.textContent = `ステータス: フルサイズの線画を事前計算中...`;
                        const fullImageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height);
                        const fullEdgeResult = applySobelFilter(fullImageData);
                        edgeCanvas = new OffscreenCanvas(mainImage.width, mainImage.height);
                        edgeCanvas.getContext('2d').putImageData(fullEdgeResult.finalEdgeImageData, 0, 0);
                        
                        if (recommendationArea) {
                            recTileSize.textContent = recommendations.tileSize;
                            recBrightness.textContent = recommendations.brightnessCompensation;
                            recTextureWeight.textContent = recommendations.textureWeight;
                            recBlendRange.textContent = recommendations.blendRange;
                            recEdgeOpacity.textContent = recommendations.edgeOpacity;
                            recommendationArea.style.display = 'block';
                            statusText.textContent = `ステータス: 推奨値を表示しました。適用ボタンを押すか、手動で設定してください。`;
                        } else {
                            statusText.textContent = `ステータス: 画像ロード完了 (推奨値エリアなし)。生成ボタンを押してください。`;
                        }

                    } catch (err) {
                        console.error("Recommendation analysis failed:", err);
                        statusText.textContent = `ステータス: 画像ロード完了 (推奨値の計算に失敗)。`;
                        if (recommendationArea) recommendationArea.style.display = 'none';
                    }
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // 「推奨値を適用」ボタンのリスナー
    if (applyRecommendationsButton) {
        // ( ... 変更なし ... )
        applyRecommendationsButton.addEventListener('click', () => {
            if (!currentRecommendations) { /* ... */ return; }
            try {
                const rec = currentRecommendations;
                tileSizeInput.value = rec.tileSize;
                brightnessCompensationInput.value = rec.brightnessCompensation;
                brightnessCompensationValue.textContent = rec.brightnessCompensation;
                textureWeightInput.value = rec.textureWeight;
                textureWeightValue.textContent = rec.textureWeight;
                blendRangeInput.value = rec.blendRange;
                blendValue.textContent = rec.blendRange;
                edgeOpacityInput.value = rec.edgeOpacity;
                edgeOpacityValue.textContent = rec.edgeOpacity;
                statusText.textContent = 'ステータス: 推奨値をスライダーに適用しました。';
            } catch (err) { /* ... */ }
        });
    }


    // 起動中の全Workerを強制終了するヘルパー関数
    function terminateWorkers() {
        workers.forEach(w => w.terminate());
        workers = [];
    }

    // --- 3. モザイク生成開始 (キャッシュ機能) ---
    generateButton.addEventListener('click', () => {
        if (!mainImage || !edgeCanvas) { /* ... */ return; }
        
        // ★ 変更点: 高画質版の生成中は二重実行を防ぐ
        if (isGeneratingFullRes) {
            statusText.textContent = 'ステータス: 現在、高画質版を生成中です...';
            return;
        }

        terminateWorkers(); 
        generateButton.disabled = true;
        downloadButton.style.display = 'none';
        progressBar.style.width = '0%';

        // 1. 現在の「重い」パラメータを取得
        const currentHeavyParams = {
            src: mainImage.src,
            tileSize: parseInt(tileSizeInput.value),
            textureWeight: parseFloat(textureWeightInput.value) / 100.0
        };

        // 2. 現在の「軽い」パラメータを取得 (描画にしか使わない)
        const currentLightParams = {
            blendOpacity: parseInt(blendRangeInput.value),
            edgeOpacity: parseInt(edgeOpacityInput.value),
            brightnessCompensation: parseInt(brightnessCompensationInput.value)
        };
        
        // ★ 変更点: プレビューモードかどうかも取得
        const isPreview = previewModeCheckbox.checked;

        // 3. キャッシュのチェック
        if (cachedResults && JSON.stringify(lastHeavyParams) === JSON.stringify(currentHeavyParams)) {
            
            // --- Case 1: 高速再描画 (Worker処理をスキップ) ---
            statusText.textContent = 'ステータス: 描画パラメータのみ変更... 高速に再描画します。';
            
            // ★ 変更点: isPreview を renderMosaic に渡す
            renderMosaic(
                cachedResults, 
                mainImage.width, 
                mainImage.height, 
                currentLightParams.blendOpacity, 
                currentLightParams.edgeOpacity, 
                currentLightParams.brightnessCompensation,
                isPreview // ★
            );
            
            generateButton.disabled = false;
            return; 
        }
        
        // --- Case 2: 通常処理 (Worker処理を実行) ---
        cachedResults = null; 
        lastHeavyParams = currentHeavyParams; 
        statusText.textContent = 'ステータス: タイル配置を計算中...';
        
        const imageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height);

        const numWorkers = navigator.hardwareConcurrency || 4;
        statusText.textContent = `ステータス: ${numWorkers}コアを検出し、並列処理を開始...`;

        let finishedWorkers = 0;
        let allResults = [];
        
        // チャンク分けロジック
        const tileSize = currentHeavyParams.tileSize; 
        const tileHeight = Math.round(tileSize * 1.0); 
        if (tileHeight <= 0) { /* ... */ }
        const alignedHeight = Math.ceil(mainImage.height / tileHeight) * tileHeight;
        const chunkHeight = Math.ceil(alignedHeight / numWorkers / tileHeight) * tileHeight;
        let startY = 0;
        let activeWorkers = 0; 
        
        for (let i = 0; i < numWorkers; i++) {
            const endY = Math.min(startY + chunkHeight, mainImage.height);
            if (startY >= endY) continue; 
            activeWorkers++; 
            const worker = new Worker('mosaic_worker.js');
            workers.push(worker);
            worker.onmessage = (e) => {
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
                        
                        cachedResults = allResults; 
                        
                        // ★ 変更点: isPreview を renderMosaic に渡す
                        renderMosaic(
                            cachedResults, 
                            mainImage.width, 
                            mainImage.height, 
                            currentLightParams.blendOpacity, 
                            currentLightParams.edgeOpacity, 
                            currentLightParams.brightnessCompensation,
                            isPreview // ★
                        );
                        terminateWorkers();
                    }
                }
            };
            worker.onerror = (error) => { /* ... (変更なし) ... */ };
            worker.postMessage({ 
                imageData: imageData, 
                tileData: tileData,
                tileSize: currentHeavyParams.tileSize,
                width: mainImage.width,
                height: mainImage.height,
                brightnessCompensation: currentLightParams.brightnessCompensation,
                textureWeight: currentHeavyParams.textureWeight,
                startY: startY,
                endY: endY
            });
            startY += chunkHeight;
        }
        if (activeWorkers === 0 && mainImage.height > 0) { /* ... (変更なし) ... */ }
    });

    // --- 4. 最終的なモザイクの描画 ---
    // ★ 変更点: isPreview を引数に追加
    async function renderMosaic(results, width, height, blendOpacity, edgeOpacity, brightnessCompensation, isPreview = true) {
        
        // ★ 変更点: 現在の描画モードをグローバルに保存
        isPreviewRender = isPreview; 

        statusText.textContent = `ステータス: タイル画像(${isPreview ? 'サムネイル' : '高画質'})を読み込み、描画中...`;
        mainCanvas.width = width;
        mainCanvas.height = height;
        ctx.clearRect(0, 0, width, height);

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
            const p = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    // ( ... 変更なし: 明度補正、クロップ/反転ロジック ... )
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
                img.onerror = () => {
                    // ★ 変更点: サムネイル(thumb_url)のロードに失敗したら、
                    // フル解像度(url)での再試行を試みる
                    if (isPreview && tile.thumb_url && img.src.includes(tile.thumb_url)) {
                        console.warn(`サムネイルのロードに失敗: ${tile.thumb_url}. フル解像度で再試行します: ${tile.url}`);
                        img.src = tile.url; // フル解像度で再試行
                    } else {
                        // フル解像度でも失敗したか、元々フル解像度だった場合
                        console.error(`タイル画像のロードに失敗: ${tile.url}`);
                        const grayValue = Math.round(tile.targetL * 2.55); 
                        ctx.fillStyle = `rgb(${grayValue}, ${grayValue}, ${grayValue})`; 
                        ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
                        loadedCount++;
                        resolve(); 
                    }
                };
                
                // ★ 変更点: isPreview に応じてURLを切り替え
                // tile.thumb_url が存在しない/nullの場合は tile.url を使う
                img.src = (isPreview && tile.thumb_url) ? tile.thumb_url : tile.url;
            });
            promises.push(p);
        }

        await Promise.all(promises);
        
        ctx.restore(); // クリッピングを解除

        progressBar.style.width = '100%';
        statusText.textContent = 'ステータス: タイル描画完了。ブレンド処理中...';

        // ( ... 変更なし: 2段階ブレンド処理 ... )
        // 1. 「陰影」ブレンド (Soft Light)
        if (blendOpacity > 0) {
            ctx.globalCompositeOperation = 'soft-light'; 
            ctx.globalAlpha = blendOpacity / 100;
            ctx.drawImage(mainImage, 0, 0, width, height);
        }
        // 2. 「線画」ブレンド (Multiply)
        if (edgeOpacity > 0 && edgeCanvas) {
            ctx.globalCompositeOperation = 'multiply'; 
            ctx.globalAlpha = edgeOpacity / 100;
            ctx.drawImage(edgeCanvas, 0, 0, width, height);
        }
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.globalAlpha = 1.0; 

        statusText.textContent = 'ステータス: モザイクアートが完成しました！';
        generateButton.disabled = false;
        downloadButton.style.display = 'block';
    }

    // --- 5. ダウンロード機能 (PNG形式) ---
    // ★ 変更点: プレビューモードの場合、高画質で再生成するロジック
    downloadButton.addEventListener('click', async () => {
        // 高画質版の生成中は二重実行を防ぐ
        if (isGeneratingFullRes) return;

        try {
            // 1. 最後の描画がプレビューだった場合、高画質で再描画する
            if (isPreviewRender) {
                isGeneratingFullRes = true;
                generateButton.disabled = true;
                downloadButton.disabled = true;
                statusText.textContent = 'ステータス: ダウンロード用に高画質版を生成中... (時間がかかります)';

                // 現在のスライダー値を取得
                const currentLightParams = {
                    blendOpacity: parseInt(blendRangeInput.value),
                    edgeOpacity: parseInt(edgeOpacityInput.value),
                    brightnessCompensation: parseInt(brightnessCompensationInput.value)
                };

                // ★ renderMosaic を isPreview = false で非同期に再実行
                await renderMosaic(
                    cachedResults, 
                    mainImage.width, 
                    mainImage.height, 
                    currentLightParams.blendOpacity, 
                    currentLightParams.edgeOpacity, 
                    currentLightParams.brightnessCompensation,
                    false // ★ 高画質モード
                );
                
                statusText.textContent = 'ステータス: 高画質版が完成しました。ダウンロードを開始します。';
                generateButton.disabled = false;
                downloadButton.disabled = false;
                isGeneratingFullRes = false;
            }
            
            // 2. (高画質版が準備できたので) ダウンロードを実行
            const dataURL = mainCanvas.toDataURL('image/png'); 
            const a = document.createElement('a');
            a.href = dataURL;
            a.download = `photomosaic-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

        } catch (err) {
            statusText.textContent = `エラー: 高画質版の生成またはダウンロードに失敗しました。 ${err.message}`;
            console.error("Download failed:", err);
            generateButton.disabled = false;
            downloadButton.disabled = false;
            isGeneratingFullRes = false;
        }
    });
});
