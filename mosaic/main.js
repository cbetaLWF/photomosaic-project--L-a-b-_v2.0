// 線画抽出（Sobel）のためのヘルパー関数
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

    // 最終描画用の線画データ (透明で初期化)
    const finalSobelData = new Uint8ClampedArray(data.length);
    
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
    
    // 3段階の閾値
    const thresholds = {
        low: 15, // 弱いディテール（質感）
        med: 30, // 最終描画用の線画
        high: 80 // 強い輪郭（アニメ線など）
    };
    
    // 3段階のディテール量を格納するベクトル
    const detailVector = { low: 0, med: 0, high: 0 };

    // 2. Sobelフィルタ適用 (1回のループで全て計算)
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sumX = 0;
            let sumY = 0;

            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx));
                    if (idx < 0 || idx >= grayscaleData.length) continue; // 境界チェック
                    const gray = grayscaleData[idx];
                    sumX += gray * Gx[ky + 1][kx + 1];
                    sumY += gray * Gy[ky + 1][kx + 1];
                }
            }

            const magnitude = Math.sqrt(sumX * sumX + sumY * sumY);
            const i = (y * width + x) * 4;

            // 1. 最終描画用の線画データ (med threshold)
            if (magnitude > thresholds.med) {
                const alpha = Math.min(255, magnitude * 1.5);
                finalSobelData[i] = 0;    // R (黒)
                finalSobelData[i + 1] = 0; // G (黒)
                finalSobelData[i + 2] = 0; // B (黒)
                finalSobelData[i + 3] = alpha; // A (不透明度)
                
                detailVector.med += alpha; // 中ディテール量
            }
            
            // 2. 賢い評価用の特徴ベクトル
            if (magnitude > thresholds.low) {
                detailVector.low += magnitude; 
            }
            if (magnitude > thresholds.high) {
                detailVector.high += magnitude;
            }
        }
    }
    
    return { 
        finalEdgeImageData: new ImageData(finalSobelData, width, height), 
        detailVector: detailVector
    };
}

// 画像を分析し、推奨値を返すヘルパー関数
function analyzeImageAndGetRecommendations(image, analysisImageData) {
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
// ヘルパー関数ここまで


document.addEventListener('DOMContentLoaded', async () => {
    // --- UI要素の取得 ---
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const edgeOpacityInput = document.getElementById('edge-opacity-range');
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const textureWeightInput = document.getElementById('texture-weight');
    const blendValue = document.getElementById('blend-value');
    const edgeOpacityValue = document.getElementById('edge-opacity-value');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    const textureWeightValue = document.getElementById('texture-weight-value');
    const recommendationArea = document.getElementById('recommendation-area');
    const applyRecommendationsButton = document.getElementById('apply-recommendations-button');
    const recTileSize = document.getElementById('rec-tile-size');
    const recBrightness = document.getElementById('rec-brightness');
    const recTextureWeight = document.getElementById('rec-texture-weight');
    const recBlendRange = document.getElementById('rec-blend-range');
    const recEdgeOpacity = document.getElementById('rec-edge-opacity');
    
    // 高速プレビューモード
    const previewModeCheckbox = document.getElementById('preview-mode-checkbox');

    const downloadSpinner = document.getElementById('download-spinner');
    const downloadWarningArea = document.getElementById('download-warning-area');
    const downloadWarningMessage = document.getElementById('download-warning-message');
    const warningYesButton = document.getElementById('warning-yes-button');
    const warningNoButton = document.getElementById('warning-no-button');
    const resolutionScaleInput = document.getElementById('resolution-scale');
    const jpegQualityInput = document.getElementById('jpeg-quality');
    
    const timingLog = document.getElementById('timing-log');

    
    // ( ... 必須要素チェック (null許容) ... )
    if (!mainCanvas || !statusText || !generateButton || !mainImageInput || !previewModeCheckbox || !tileSizeInput) {
        console.error("Initialization Error: One or more critical HTML elements are missing.");
        document.body.innerHTML = "<h1>Initialization Error</h1><p>The application failed to load because critical elements (Canvas, Buttons, Status, mainImageInput, previewModeCheckbox, tileSizeInput) are missing from the HTML.</p>";
        return;
    }
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null;
    let mainImage = null;
    let workers = [];
    let edgeCanvas = null; 
    let currentRecommendations = null;
    let cachedResults = null; 
    let lastHeavyParams = {}; 
    let isGeneratingFullRes = false; 
    let lastGeneratedBlob = null; 
    
    let isPreviewRender = true;
    let t_worker_start = 0;


    // ( ... UIの初期設定 (スライダーリスナー) ... )
    generateButton.disabled = true;
    if(downloadButton) downloadButton.style.display = 'none';
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
        
        // ★ 変更点: thumb_url のチェックを再追加
        if (tileData.length === 0 || 
            !tileData[0].patterns || 
            tileData[0].patterns.length === 0 || 
            !tileData[0].patterns[0].l_vector ||
            tileData[0].patterns[0].l_vector.length !== 9 ||
            !tileData[0].thumb_url) { 
             throw new Error('tile_data.jsonが古いか 6倍拡張(3x3)ベクトル/thumb_urlではありません。Analyzer Appで新しいデータを再生成してください。');
        }
        
        statusText.textContent = `ステータス: タイルデータ (${tileData.length}枚 / ${tileData.length * (tileData[0].patterns ? tileData[0].patterns.length : 0)}パターン) ロード完了。メイン画像を選択してください。`;
        if (mainImageInput) mainImageInput.disabled = false;
    } catch (error) {
        statusText.textContent = `エラー: ${error.message}`;
        console.error("Initialization Error:", error);
        return;
    }
    
    // ( ... 2. メイン画像アップロード (推奨値/線画計算) ... )
    if (mainImageInput) {
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
                    if(downloadButton) downloadButton.style.display = 'none';
                    mainCanvas.width = mainImage.width;
                    mainCanvas.height = mainImage.height;
                    
                    // Canvasを元画像でリセット (Worker準備のため)
                    ctx.clearRect(0, 0, mainImage.width, mainImage.height); 
                    ctx.drawImage(mainImage, 0, 0); 
                    
                    statusText.textContent = `ステータス: 画像ロード完了。推奨値を計算中...`;

                    if (recommendationArea && applyRecommendationsButton) {
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
                            
                            if (recTileSize) recTileSize.textContent = recommendations.tileSize;
                            if (recBrightness) recBrightness.textContent = recommendations.brightnessCompensation;
                            if (recTextureWeight) recTextureWeight.textContent = recommendations.textureWeight;
                            if (recBlendRange) recBlendRange.textContent = recommendations.blendRange;
                            if (recEdgeOpacity) recEdgeOpacity.textContent = recommendations.edgeOpacity;
                            recommendationArea.style.display = 'block';
                            statusText.textContent = `ステータス: 推奨値を表示しました。適用ボタンを押すか、手動で設定してください。`;
                        } catch (err) {
                            console.error("Recommendation analysis failed:", err);
                            statusText.textContent = `ステータス: 画像ロード完了 (推奨値の計算に失敗)。`;
                            if (recommendationArea) recommendationArea.style.display = 'none';
                        }
                    } else { /* ( ... 推奨値エリアなしの場合 ... ) */ }
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // ★ 修正点: 問題②対応 - applyRecommendationsButton リスナーの実装 (変更なし)
    if (applyRecommendationsButton) {
        applyRecommendationsButton.addEventListener('click', () => {
            if (!currentRecommendations) return;
            
            // 1. タイル幅 (number input)
            if (tileSizeInput) tileSizeInput.value = currentRecommendations.tileSize;

            // 2. L*明度補正 (range slider)
            if (brightnessCompensationInput) {
                brightnessCompensationInput.value = currentRecommendations.brightnessCompensation;
                if (brightnessCompensationValue) brightnessCompensationValue.textContent = currentRecommendations.brightnessCompensation;
            }

            // 3. テクスチャ重視度 (range slider)
            if (textureWeightInput) {
                textureWeightInput.value = currentRecommendations.textureWeight;
                if (textureWeightValue) textureWeightValue.textContent = currentRecommendations.textureWeight;
            }

            // 4. ブレンド度 (range slider)
            if (blendRangeInput) {
                blendRangeInput.value = currentRecommendations.blendRange;
                if (blendValue) blendValue.textContent = currentRecommendations.blendRange;
            }

            // 5. 線画の強さ (range slider)
            if (edgeOpacityInput) {
                edgeOpacityInput.value = currentRecommendations.edgeOpacity;
                if (edgeOpacityValue) edgeOpacityValue.textContent = currentRecommendations.edgeOpacity;
            }

            statusText.textContent = 'ステータス: 推奨パラメータを適用しました。';
            // ヘビーパラメータ（タイルサイズ、テクスチャ）が変わった可能性があるのでキャッシュをクリア
            cachedResults = null;
            lastHeavyParams = {};
            generateButton.disabled = false;
        });
    }

    function terminateWorkers() {
        workers.forEach(worker => worker.terminate());
        workers = [];
    }


    // --- 3. モザイク生成開始 (キャッシュ機能 + タイマー) ---
    generateButton.addEventListener('click', () => {
        if (!mainImage || !edgeCanvas) { /* ... */ return; }
        if (isGeneratingFullRes) { /* ... */ return; }

        terminateWorkers(); 
        generateButton.disabled = true;
        if (downloadButton) downloadButton.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        if (timingLog) timingLog.textContent = '処理時間 (テスト用):'; // ★ ログリセット

        const currentHeavyParams = {
            src: mainImage.src,
            tileSize: parseInt(tileSizeInput ? tileSizeInput.value : 20), 
            textureWeight: parseFloat(textureWeightInput ? textureWeightInput.value : 50) / 100.0 
        };
        const currentLightParams = {
            blendOpacity: parseInt(blendRangeInput ? blendRangeInput.value : 30),
            edgeOpacity: parseInt(edgeOpacityInput ? edgeOpacityInput.value : 30),
            brightnessCompensation: parseInt(brightnessCompensationInput ? brightnessCompensationInput.value : 100)
        };
        
        const isPreview = previewModeCheckbox.checked; 

        // ★ 修正点: 問題③対策 - タイルサイズが変更されたかを明示的にチェック
        const isTileSizeChanged = lastHeavyParams.tileSize !== currentHeavyParams.tileSize;
        
        // 3. キャッシュのチェック
        // タイルサイズが変わっておらず、かつ、キャッシュが存在し、その他HeavyParamsが変わっていない場合のみ高速再描画
        if (!isTileSizeChanged && cachedResults && JSON.stringify(lastHeavyParams) === JSON.stringify(currentHeavyParams)) {
            
            // --- Case 1: 高速再描画 (Worker処理をスキップ) ---
            statusText.textContent = 'ステータス: 描画パラメータのみ変更... 高速に再描画します。';
            
            const t_render_start = performance.now(); // ★ タイマー開始
            
            renderMosaic(
                mainCanvas, 
                cachedResults, 
                mainImage.width, 
                mainImage.height, 
                currentLightParams.blendOpacity, 
                currentLightParams.edgeOpacity, 
                currentLightParams.brightnessCompensation,
                isPreview // ★ プレビューフラグを渡す
            ).then(() => {
                // ★ 変更点: 高速再描画（フェーズ2）の時間計測
                const t_render_end = performance.now();
                const renderTime = (t_render_end - t_render_start) / 1000.0;
                if(timingLog) timingLog.textContent += `\n[キャッシュ使用] 再描画 (F2) (${isPreview ? 'Thumb' : 'Full'}): ${renderTime.toFixed(3)} 秒`;
            });
            
            generateButton.disabled = false;
            return; 
        }
        
        // --- Case 2: 通常処理 (Worker処理を実行) ---
        // タイルサイズが変わった場合、またはその他のHeavyParamsが変わった場合は、再計算
        cachedResults = null; 
        lastHeavyParams = currentHeavyParams; 
        statusText.textContent = 'ステータス: タイル配置を計算中...';
        
        t_worker_start = performance.now(); 
        
        // ★★★ 最終修正点: Workerに渡すImageData取得前にCanvasを元画像で上書きし、ピクセルデータの汚染を防ぐ ★★★
        ctx.clearRect(0, 0, mainImage.width, mainImage.height);
        ctx.drawImage(mainImage, 0, 0); 
        // ★★★ 最終修正点ここまで ★★★
        
        const imageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height); // ★ ここでクリーンな元画像データを取得
        const numWorkers = navigator.hardwareConcurrency || 4;
        statusText.textContent = `ステータス: ${numWorkers}コアを検出し、並列処理を開始...`;

        let finishedWorkers = 0;
        let allResults = [];
        
        // ( ... チャンク分けロジック ... )
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
                    if (progressBar) { /* ... */ }
                } else if (e.data.type === 'complete') {
                    allResults = allResults.concat(e.data.results);
                    finishedWorkers++;
                    if (finishedWorkers === activeWorkers) {
                        // ★ 変更点: フェーズ1（Worker）の時間計測
                        const t_worker_end = performance.now();
                        const workerTime = (t_worker_end - t_worker_start) / 1000.0;
                        if(timingLog) timingLog.textContent += `\nWorker 配置計算 (F1): ${workerTime.toFixed(3)} 秒`;

                        statusText.textContent = 'ステータス: 全ワーカー処理完了。描画中...';
                        if (progressBar) progressBar.style.width = '100%';
                        
                        cachedResults = allResults; 
                        
                        renderMosaic(
                            mainCanvas,
                            cachedResults, 
                            mainImage.width, 
                            mainImage.height, 
                            currentLightParams.blendOpacity, 
                            currentLightParams.edgeOpacity, 
                            currentLightParams.brightnessCompensation,
                            isPreview // ★ プレビューフラグを渡す
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
    async function renderMosaic(
        targetCanvas, 
        results, width, height,
        blendOpacity, edgeOpacity, brightnessCompensation, 
        isPreview = true, // ★ プレビューフラグ
        scale = 1.0 
    ) {
        
        isPreviewRender = isPreview; 

        const t_render_start = performance.now(); // ★ タイマー開始 (F2)

        const canvasWidth = width * scale;
        const canvasHeight = height * scale;
        
        targetCanvas.width = canvasWidth;
        targetCanvas.height = canvasHeight;
        const ctx = targetCanvas.getContext('2d');
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        
        statusText.textContent = `ステータス: タイル画像(${isPreview ? 'サムネイル' : '高画質'})を読み込み、描画中 (スケール: ${scale}x)...`;

        ctx.save(); 
        ctx.beginPath();
        ctx.rect(0, 0, canvasWidth, canvasHeight); 
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
                    // ( ... 明度補正、クロップ/反転ロジック ... )
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
                    const dx = tile.x * scale;
                    const dy = tile.y * scale;
                    const dWidth = tile.width * scale;
                    const dHeight = tile.height * scale; 
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
                    // ★ 修正点: 問題①対応 - サムネイルロード失敗時のフォールバックロジック
                    if (isPreview && tile.thumb_url && img.src.includes(tile.thumb_url)) {
                        // サムネイルのロードが失敗した場合、フル解像度で再試行する
                        console.warn(`サムネイルのロードに失敗: ${tile.thumb_url}. フル解像度で再試行します: ${tile.url}`);
                        img.src = tile.url; 
                    } else {
                        // フル解像度も失敗した場合、ターゲットL*で単色タイルを描画
                        console.error(`タイル画像のロードに失敗: ${tile.url}`);
                        const grayValue = Math.round(tile.targetL * 2.55); 
                        ctx.fillStyle = `rgb(${grayValue}, ${grayValue}, ${grayValue})`; 
                        ctx.fillRect(tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale); 
                        loadedCount++;
                        resolve(); 
                    }
                };
                
                // isPreviewフラグに応じてURLを切り替え
                img.src = (isPreview && tile.thumb_url) ? tile.thumb_url : tile.url;
            });
            promises.push(p);
        }

        await Promise.all(promises);
        
        const t_render_load_end = performance.now(); // ★ タイマー (F2 ロード完了)
        
        ctx.restore(); // クリッピングを解除

        if (progressBar) progressBar.style.width = '100%';
        statusText.textContent = 'ステータス: タイル描画完了。ブレンド処理中...';

        // 2段階ブレンド処理
        if (blendOpacity > 0 && mainImage) {
            ctx.globalCompositeOperation = 'soft-light'; 
            ctx.globalAlpha = blendOpacity / 100;
            ctx.drawImage(mainImage, 0, 0, canvasWidth, canvasHeight);
        }
        if (edgeOpacity > 0 && edgeCanvas) {
            ctx.globalCompositeOperation = 'multiply'; 
            ctx.globalAlpha = edgeOpacity / 100;
            ctx.drawImage(edgeCanvas, 0, 0, canvasWidth, canvasHeight);
        }
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.globalAlpha = 1.0; 

        statusText.textContent = 'ステータス: モザイクアートが完成しました！';
        
        const t_render_blend_end = performance.now(); // ★ タイマー (F2 完了)
        
        // ★ 変更点: フェーズ2（描画）の時間計測
        const loadTime = (t_render_load_end - t_render_start) / 1000.0;
        const blendTime = (t_render_blend_end - t_render_load_end) / 1000.0;
        const totalRenderTime = (t_render_blend_end - t_render_start) / 1000.0;
        if(timingLog) {
            // isPreviewに応じてログを変更
            timingLog.textContent += `\n描画 (F2) (${isPreview ? 'Thumb' : 'Full'}) 合計: ${totalRenderTime.toFixed(3)} 秒`;
            timingLog.textContent += `\n  - タイルロード/描画: ${loadTime.toFixed(3)} 秒`;
            timingLog.textContent += `\n  - ブレンド/線画合成: ${blendTime.toFixed(3)} 秒`;
        }

        // プレビュー描画時のみ、ボタンを有効化
        if (isPreview) {
            generateButton.disabled = false;
            if (downloadButton) downloadButton.style.display = 'block';
        }
    }

    // --- 5. ダウンロード機能 (JPEG & 警告対応) ---
    if (downloadButton) {
        downloadButton.addEventListener('click', async () => {
            if (isGeneratingFullRes) return; 
            if (!cachedResults || !mainImage) { /* ... */ return; }

            if (downloadWarningArea) downloadWarningArea.style.display = 'none';
            lastGeneratedBlob = null;
            
            try {
                isGeneratingFullRes = true;
                generateButton.disabled = true;
                downloadButton.disabled = true;
                if (downloadSpinner) downloadSpinner.style.display = 'inline-block';
                statusText.textContent = 'ステータス: 高画質版を生成中... (時間がかかります)';

                const t_download_start = performance.now(); // ★ タイマー開始 (F3)

                // ( ... lightParams, scale, quality の取得 ... )
                const lightParams = {
                    blendOpacity: parseInt(blendRangeInput ? blendRangeInput.value : 30),
                    edgeOpacity: parseInt(edgeOpacityInput ? edgeOpacityInput.value : 30),
                    brightnessCompensation: parseInt(brightnessCompensationInput ? brightnessCompensationInput.value : 100)
                };
                const scale = parseFloat(resolutionScaleInput ? resolutionScaleInput.value : 1.0);
                const quality = parseInt(jpegQualityInput ? jpegQualityInput.value : 90) / 100.0; 

                // 2. 高画質版は「オフスクリーンCanvas」で生成
                const highResCanvas = new OffscreenCanvas(mainImage.width * scale, mainImage.height * scale);
                
                // ★★★ 最終修正点: Workerに渡すImageData取得前にCanvasを元画像で上書きし、ピクセルデータの汚染を防ぐ ★★★
                highResCanvas.getContext('2d').clearRect(0, 0, mainImage.width, mainImage.height);
                highResCanvas.getContext('2d').drawImage(mainImage, 0, 0, mainImage.width * scale, mainImage.height * scale); 
                // (Workerに渡すImageDataはメインスレッドのCanvasから取得するが、ダウンロード用Canvasのベースも元画像である必要があるため、元画像を描画)
                // ★★★ 最終修正点ここまで（mainCanvasのリセットは不要、WorkerへのImageDataは既に修正済みのため） ★★★
                
                await renderMosaic(
                    highResCanvas, // オフスクリーンCanvasに描画
                    cachedResults, 
                    mainImage.width, 
                    mainImage.height, 
                    lightParams.blendOpacity, 
                    lightParams.edgeOpacity, 
                    lightParams.brightnessCompensation,
                    false, // ★ isPreview=false (高画質ロード)
                    scale // ★ 解像度スケール
                );
                
                const t_download_render_end = performance.now(); // ★ タイマー (F3 描画完了)
                
                statusText.textContent = 'ステータス: 高画質版をJPEGに変換中...';

                // 3. CanvasからJPEG Blobを生成
                const blob = await highResCanvas.convertToBlob({
                    type: 'image/jpeg',
                    quality: quality
                });
                
                const t_download_blob_end = performance.now(); // ★ タイマー (F3 完了)
                
                // ★ 変更点: フェーズ3（ダウンロード）の時間計測
                const downloadRenderTime = (t_download_render_end - t_download_start) / 1000.0;
                const blobTime = (t_download_blob_end - t_download_render_end) / 1000.0;
                if (timingLog) {
                    timingLog.textContent += `\n---`;
                    timingLog.textContent += `\nダウンロード描画 (F3): ${downloadRenderTime.toFixed(3)} 秒`;
                    timingLog.textContent += `\nJPEG変換 (F3): ${blobTime.toFixed(3)} 秒`;
                }

                // ( ... ファイルサイズチェックと警告 ... )
                const fileSizeMB = blob.size / 1024 / 1024;
                const limitMB = 15;
                if (fileSizeMB <= limitMB || !downloadWarningArea) {
                    statusText.textContent = `ステータス: 高画質版 ( ${fileSizeMB.toFixed(1)} MB) の準備完了。`;
                    downloadBlob(blob, `photomosaic-${Date.now()}.jpg`);
                } else {
                    lastGeneratedBlob = blob; 
                    downloadWarningMessage.textContent = `警告: ファイルサイズが ${fileSizeMB.toFixed(1)} MB となり、X/Twitterの上限(15MB)を超えています。このままダウンロードしますか？`;
                    downloadWarningArea.style.display = 'block';
                    statusText.textContent = 'ステータス: 警告！ ファイルサイズが15MBを超えました。';
                }

            } catch (err) {
                statusText.textContent = `エラー: 高画質版の生成またはダウンロードに失敗しました。 ${err.message}`;
                console.error("Download failed:", err);
            } finally {
                // ( ... 完了処理 ... )
                isGeneratingFullRes = false;
                generateButton.disabled = false;
                downloadButton.disabled = false;
                if (downloadSpinner) downloadSpinner.style.display = 'none';
            }
        });
    }

    // ( ... 警告Yes/Noボタンのリスナー ... )
    if (warningYesButton) { /* ... */ }
    if (warningNoButton) { /* ... */ }

});

// ( ... 独立した downloadBlob 関数 ... )
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
