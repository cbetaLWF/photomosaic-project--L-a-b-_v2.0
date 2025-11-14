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
        low: 15,  // 弱いディテール（質感）
        med: 30,  // 最終描画用の線画
        high: 80  // 強い輪郭（アニメ線など）
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
                finalSobelData[i] = 0;     // R (黒)
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
// ヘルパー関数ここまで


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
    
    // applySobelFilterは { finalEdgeImageData, detailVector } を返す
    const edgeResult = applySobelFilter(analysisImageData); 
    const detailVector = edgeResult.detailVector; 
    
    // 0除算を避ける
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
    
    // 推奨値だけを返す
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

    // 高速プレビュー
    const previewModeCheckbox = document.getElementById('preview-mode-checkbox');

    // ダウンロードと警告のUI
    const downloadSpinner = document.getElementById('download-spinner');
    const downloadWarningArea = document.getElementById('download-warning-area');
    const downloadWarningMessage = document.getElementById('download-warning-message');
    const warningYesButton = document.getElementById('warning-yes-button');
    const warningNoButton = document.getElementById('warning-no-button');
    const resolutionScaleInput = document.getElementById('resolution-scale');
    const jpegQualityInput = document.getElementById('jpeg-quality');
    
    
    // ★ 変更点: 必須要素チェックを、本当に必須なものだけにする
    // (推奨値エリア(recommendationArea)やスライダーはオプションとする)
    if (!mainCanvas || !statusText || !generateButton || !mainImageInput) {
        console.error("Initialization Error: One or more critical HTML elements are missing.");
        document.body.innerHTML = "<h1>Initialization Error</h1><p>The application failed to load because critical elements (Canvas, Buttons, Status, mainImageInput) are missing from the HTML.</p>";
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
    let isPreviewRender = true; 
    let isGeneratingFullRes = false; 

    // 15MB超過のBlobを一時保存
    let lastGeneratedBlob = null; 


    // --- UIの初期設定 ---
    generateButton.disabled = true;
    if(downloadButton) downloadButton.style.display = 'none';

    // スライダーのリスナー (nullチェックでラップ)
    if (brightnessCompensationInput && brightnessCompensationValue) {
        brightnessCompensationInput.addEventListener('input', () => {
            brightnessCompensationValue.textContent = brightnessCompensationInput.value;
        });
    }
    if (textureWeightInput && textureWeightValue) {
        textureWeightInput.addEventListener('input', () => {
            textureWeightValue.textContent = textureWeightInput.value;
        });
    }
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
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        if (!response.ok) { throw new Error(`tile_data.json のロードに失敗しました (HTTP ${response.status})。`); }
        tileData = await response.json();
        
        // 6倍拡張(3x3)ベクトル/thumb_urlのJSONチェック
        if (tileData.length === 0 || 
            !tileData[0].patterns || 
            tileData[0].patterns.length === 0 || 
            !tileData[0].patterns[0].l_vector ||
            tileData[0].patterns[0].l_vector.length !== 9 ||
            !tileData[0].thumb_url) { // thumb_urlのチェックも追加
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
                    ctx.clearRect(0, 0, mainImage.width, mainImage.height);
                    ctx.drawImage(mainImage, 0, 0); // プレビュー表示
                    statusText.textContent = `ステータス: 画像ロード完了。推奨値を計算中...`;

                    // (推奨値エリアとボタンがHTMLに存在する場合のみ実行)
                    if (recommendationArea && applyRecommendationsButton) {
                        try {
                            // (推奨値の計算)
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
                            
                            // (線画の事前計算)
                            statusText.textContent = `ステータス: フルサイズの線画を事前計算中...`;
                            const fullImageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height);
                            const fullEdgeResult = applySobelFilter(fullImageData);
                            edgeCanvas = new OffscreenCanvas(mainImage.width, mainImage.height);
                            edgeCanvas.getContext('2d').putImageData(fullEdgeResult.finalEdgeImageData, 0, 0);
                            
                            // (推奨値エリアのテキストを更新)
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
                    } else {
                        // 推奨値エリアがない場合、線画だけ事前計算する
                        try {
                            statusText.textContent = `ステータス: フルサイズの線画を事前計算中...`;
                            const fullImageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height);
                            const fullEdgeResult = applySobelFilter(fullImageData);
                            edgeCanvas = new OffscreenCanvas(mainImage.width, mainImage.height);
                            edgeCanvas.getContext('2d').putImageData(fullEdgeResult.finalEdgeImageData, 0, 0);
                            statusText.textContent = `ステータス: 画像ロード完了。生成ボタンを押してください。`;
                        } catch (err) {
                            console.error("Edge pre-calculation failed:", err);
                            statusText.textContent = `ステータス: 画像ロード完了 (線画の事前計算に失敗)。`;
                        }
                    }
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // 「推奨値を適用」ボタンのリスナー (nullチェック付き)
    if (applyRecommendationsButton) {
        applyRecommendationsButton.addEventListener('click', () => {
            if (!currentRecommendations) {
                statusText.textContent = 'ステータス: メイン画像をアップロードして、まず推奨値を計算してください。';
                return;
            }
            try {
                const rec = currentRecommendations;
                // 各スライダーが存在するかチェックしてから値を設定
                if(tileSizeInput) tileSizeInput.value = rec.tileSize;
                
                if(brightnessCompensationInput) brightnessCompensationInput.value = rec.brightnessCompensation;
                if(brightnessCompensationValue) brightnessCompensationValue.textContent = rec.brightnessCompensation;
                
                if(textureWeightInput) textureWeightInput.value = rec.textureWeight;
                if(textureWeightValue) textureWeightValue.textContent = rec.textureWeight;
                
                if(blendRangeInput) blendRangeInput.value = rec.blendRange;
                if(blendValue) blendValue.textContent = rec.blendRange;
                
                if(edgeOpacityInput) edgeOpacityInput.value = rec.edgeOpacity;
                if(edgeOpacityValue) edgeOpacityValue.textContent = rec.edgeOpacity;

                statusText.textContent = 'ステータス: 推奨値をスライダーに適用しました。';
            } catch (err) {
                 console.error("Failed to apply recommendations:", err);
                 statusText.textContent = 'ステータス: 推奨値の適用に失敗しました。';
            }
        });
    }


    // 起動中の全Workerを強制終了するヘルパー関数
    function terminateWorkers() {
        workers.forEach(w => w.terminate());
        workers = [];
    }

    // --- 3. モザイク生成開始 (キャッシュ機能) ---
    generateButton.addEventListener('click', () => {
        if (!mainImage || !edgeCanvas) { 
            statusText.textContent = 'エラー: メイン画像がロードされていないか、線画の計算が完了していません。';
            return;
        }
        
        if (isGeneratingFullRes) {
            statusText.textContent = 'ステータス: 現在、高画質版を生成中です...';
            return;
        }

        terminateWorkers(); 
        generateButton.disabled = true;
        if (downloadButton) downloadButton.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';

        // 1. 現在の「重い」パラメータを取得
        const currentHeavyParams = {
            src: mainImage.src,
            tileSize: parseInt(tileSizeInput ? tileSizeInput.value : 20), // nullの場合のフォールバック
            textureWeight: parseFloat(textureWeightInput ? textureWeightInput.value : 50) / 100.0 // nullの場合のフォールバック
        };

        // 2. 現在の「軽い」パラメータを取得 (描画にしか使わない)
        const currentLightParams = {
            blendOpacity: parseInt(blendRangeInput ? blendRangeInput.value : 30),
            edgeOpacity: parseInt(edgeOpacityInput ? edgeOpacityInput.value : 30),
            brightnessCompensation: parseInt(brightnessCompensationInput ? brightnessCompensationInput.value : 100)
        };
        
        // プレビューモードかどうかも取得
        const isPreview = previewModeCheckbox ? previewModeCheckbox.checked : true;

        // 3. キャッシュのチェック
        if (cachedResults && JSON.stringify(lastHeavyParams) === JSON.stringify(currentHeavyParams)) {
            
            // --- Case 1: 高速再描画 (Worker処理をスキップ) ---
            statusText.textContent = 'ステータス: 描画パラメータのみ変更... 高速に再描画します。';
            
            renderMosaic(
                mainCanvas, // プレビューは常に mainCanvas に描画
                cachedResults, 
                mainImage.width, 
                mainImage.height, 
                currentLightParams.blendOpacity, 
                currentLightParams.edgeOpacity, 
                currentLightParams.brightnessCompensation,
                isPreview 
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
        if (tileHeight <= 0) {
            statusText.textContent = 'エラー: タイルサイズは0より大きくしてください。';
            generateButton.disabled = false;
            return;
        }
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
                    if (progressBar) {
                        const currentProgress = parseFloat(progressBar.style.width) || 0;
                        const newProgress = currentProgress + (e.data.progress * 100 / activeWorkers);
                        progressBar.style.width = `${newProgress}%`;
                    }
                } else if (e.data.type === 'complete') {
                    allResults = allResults.concat(e.data.results);
                    finishedWorkers++;
                    if (finishedWorkers === activeWorkers) {
                        statusText.textContent = 'ステータス: 全ワーカー処理完了。描画中...';
                        if (progressBar) progressBar.style.width = '100%';
                        
                        cachedResults = allResults; 
                        
                        renderMosaic(
                            mainCanvas, // プレビューは常に mainCanvas に描画
                            cachedResults, 
                            mainImage.width, 
                            mainImage.height, 
                            currentLightParams.blendOpacity, 
                            currentLightParams.edgeOpacity, 
                            currentLightParams.brightnessCompensation,
                            isPreview
                        );
                        terminateWorkers();
                    }
                }
            };
            worker.onerror = (error) => {
                statusText.textContent = `エラー: Worker ${i+1} で問題が発生しました。 ${error.message}`;
                terminateWorkers();
                generateButton.disabled = false;
                console.error(`Worker ${i+1} Error:`, error);
            };
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
        if (activeWorkers === 0 && mainImage.height > 0) {
             statusText.textContent = 'ステータス: Workerを起動できませんでした。';
             generateButton.disabled = false;
        }
    });

    // --- 4. 最終的なモザイクの描画 ---
    async function renderMosaic(
        targetCanvas, // 描画対象のCanvas
        results, 
        width, // 元画像の幅
        height, // 元画像の高さ
        blendOpacity, 
        edgeOpacity, 
        brightnessCompensation, 
        isPreview = true,
        scale = 1.0 // デフォルトは1.0
    ) {
        
        isPreviewRender = isPreview; // 現在の描画モードを保存

        // スケールを適用したCanvasサイズ
        const canvasWidth = width * scale;
        const canvasHeight = height * scale;
        
        targetCanvas.width = canvasWidth;
        targetCanvas.height = canvasHeight;
        const ctx = targetCanvas.getContext('2d');
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        
        statusText.textContent = `ステータス: タイル画像(${isPreview ? 'サムネイル' : '高画質'})を読み込み、描画中 (スケール: ${scale}x)...`;

        // クリッピング設定
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
                    
                    // 描画先の座標とサイズに scale を適用
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
                    if (isPreview && tile.thumb_url && img.src.includes(tile.thumb_url)) {
                        console.warn(`サムネイルのロードに失敗: ${tile.thumb_url}. フル解像度で再試行します: ${tile.url}`);
                        img.src = tile.url; // フル解像度で再試行
                    } else {
                        console.error(`タイル画像のロードに失敗: ${tile.url}`);
                        const grayValue = Math.round(tile.targetL * 2.55); 
                        ctx.fillStyle = `rgb(${grayValue}, ${grayValue}, ${grayValue})`; 
                        ctx.fillRect(tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale); // ★ scale適用
                        loadedCount++;
                        resolve(); 
                    }
                };
                
                img.src = (isPreview && tile.thumb_url) ? tile.thumb_url : tile.url;
            });
            promises.push(p);
        }

        await Promise.all(promises);
        
        ctx.restore(); // クリッピングを解除

        if (progressBar) progressBar.style.width = '100%';
        statusText.textContent = 'ステータス: タイル描画完了。ブレンド処理中...';

        // 2段階ブレンド処理 (描画サイズに scale を適用)
        // 1. 「陰影」ブレンド (Soft Light)
        if (blendOpacity > 0) {
            ctx.globalCompositeOperation = 'soft-light'; 
            ctx.globalAlpha = blendOpacity / 100;
            ctx.drawImage(mainImage, 0, 0, canvasWidth, canvasHeight);
        }
        // 2. 「線画」ブレンド (Multiply)
        if (edgeOpacity > 0 && edgeCanvas) {
            ctx.globalCompositeOperation = 'multiply'; 
            ctx.globalAlpha = edgeOpacity / 100;
            ctx.drawImage(edgeCanvas, 0, 0, canvasWidth, canvasHeight);
        }
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.globalAlpha = 1.0; 

        statusText.textContent = 'ステータス: モザイクアートが完成しました！';
        
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
            if (!cachedResults) {
                statusText.textContent = 'エラー: まず「モザイク生成」を実行してください。';
                return;
            }

            // 警告エリアを非表示にし、Blobをリセット
            if (downloadWarningArea) downloadWarningArea.style.display = 'none';
            lastGeneratedBlob = null;
            
            try {
                isGeneratingFullRes = true;
                generateButton.disabled = true;
                downloadButton.disabled = true;
                if (downloadSpinner) downloadSpinner.style.display = 'inline';
                statusText.textContent = 'ステータス: 高画質版を生成中... (時間がかかります)';

                // 1. 現在のスライダー値を取得
                const lightParams = {
                    blendOpacity: parseInt(blendRangeInput ? blendRangeInput.value : 30),
                    edgeOpacity: parseInt(edgeOpacityInput ? edgeOpacityInput.value : 30),
                    brightnessCompensation: parseInt(brightnessCompensationInput ? brightnessCompensationInput.value : 100)
                };
                const scale = parseFloat(resolutionScaleInput ? resolutionScaleInput.value : 1.0);
                const quality = parseInt(jpegQualityInput ? jpegQualityInput.value : 90) / 100.0; 

                // 2. 高画質版は「オフスクリーンCanvas」で生成
                const highResCanvas = new OffscreenCanvas(mainImage.width * scale, mainImage.height * scale);
                
                await renderMosaic(
                    highResCanvas, // オフスクリーンCanvasに描画
                    cachedResults, 
                    mainImage.width, 
                    mainImage.height, 
                    lightParams.blendOpacity, 
                    lightParams.edgeOpacity, 
                    lightParams.brightnessCompensation,
                    false, // 高画質モード (isPreview=false)
                    scale  // 解像度スケール
                );
                
                statusText.textContent = 'ステータス: 高画質版をJPEGに変換中...';

                // 3. CanvasからJPEG Blobを生成
                const blob = await highResCanvas.convertToBlob({
                    type: 'image/jpeg',
                    quality: quality
                });

                // 4. ファイルサイズをチェック (15MB)
                const fileSizeMB = blob.size / 1024 / 1024;
                const limitMB = 15;

                if (fileSizeMB <= limitMB || !downloadWarningArea) {
                    // 15MB以下、または警告エリアがない場合: 即座にダウンロード
                    statusText.textContent = `ステータス: 高画質版 ( ${fileSizeMB.toFixed(1)} MB) の準備完了。`;
                    downloadBlob(blob, `photomosaic-${Date.now()}.jpg`);
                } else {
                    // 15MB超過: 警告を表示
                    lastGeneratedBlob = blob; // YesボタンのためにBlobを保存
                    downloadWarningMessage.textContent = `警告: ファイルサイズが ${fileSizeMB.toFixed(1)} MB となり、X/Twitterの上限(15MB)を超えています。このままダウンロードしますか？`;
                    downloadWarningArea.style.display = 'block';
                    statusText.textContent = 'ステータス: 警告！ ファイルサイズが15MBを超えました。';
                }

            } catch (err) {
                statusText.textContent = `エラー: 高画質版の生成またはダウンロードに失敗しました。 ${err.message}`;
                console.error("Download failed:", err);
            } finally {
                // 完了（または警告表示）したら、ボタンを元に戻す
                isGeneratingFullRes = false;
                generateButton.disabled = false;
                downloadButton.disabled = false;
                if (downloadSpinner) downloadSpinner.style.display = 'none';
            }
        });
    }

    // 警告Yes/Noボタンのリスナー (nullチェック付き)
    if (warningYesButton) {
        warningYesButton.addEventListener('click', () => {
            if (lastGeneratedBlob) {
                statusText.textContent = 'ステータス: 15MB超過のファイルをダウンロードします...';
                downloadBlob(lastGeneratedBlob, `photomosaic-large-${Date.now()}.jpg`);
            }
            lastGeneratedBlob = null;
            if (downloadWarningArea) downloadWarningArea.style.display = 'none';
        });
    }
    if (warningNoButton) {
        warningNoButton.addEventListener('click', () => {
            lastGeneratedBlob = null;
            if (downloadWarningArea) downloadWarningArea.style.display = 'none';
            statusText.textContent = 'ステータス: ダウンロードをキャンセルしました。';
        });
    }

});

// 独立した関数としてダウンロード関数を定義
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
