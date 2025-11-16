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


// ★ 修正点: ダウンロードアドバイスのためのヘルパー関数
function highlightParameter(element) {
    if (!element) return;
    element.style.borderColor = '#dc2626'; // Red-600
    element.style.borderWidth = '2px';
    element.style.boxShadow = '0 0 5px rgba(220, 38, 38, 0.5)';
}
function resetParameterStyles(elements) {
    elements.forEach(element => {
        if (element) {
            element.style.borderColor = '';
            element.style.borderWidth = '';
            element.style.boxShadow = '';
        }
    });
}


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
    
    // ★★★ 修正点: 全工程の時間計測のための基準点 ★★★
    const t_app_start = performance.now();
    let t_f3_preload_start = 0;
    let t_f1_click = 0;
    let t_f3_click = 0;
    
    // ( ... 環境ログ (nullチェック済み) ... )
    if (timingLog) {
        timingLog.textContent = ''; 
        const cpuCores = navigator.hardwareConcurrency || 'N/A';
        const deviceRam = navigator.deviceMemory || 'N/A';
        timingLog.innerHTML = `[環境] CPUコア: ${cpuCores}, RAM: ${deviceRam} GB`;
    }
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null; 
    let mainImage = null; 
    let workers = []; // ★ 修正: F1 / F2 / F3 Workerが都度入る
    let edgeCanvas = null; 
    let currentRecommendations = null;
    
    // ★★★ 修正点: Gプラン (cachedResultsはDBにある) ★★★
    let cachedResults = null; // F1計算が完了したか(true/false)のフラグとして使用
    
    let lastHeavyParams = {}; 
    let isGeneratingFullRes = false; 
    let lastGeneratedBlob = null; 
    let thumbSheetImage = null; 
    
    // ★ 修正: F1 / F2 の実行中フラグを分離
    let isGeneratingF1 = false;
    let isGeneratingF2 = false;
    
    let preloadPromise = null; 
    
    // ★★★ 修正点: Cプラン (ハイブリッド・メモリキャッシュ) ★★★
    let f3SheetCache = new Map(); // グローバル変数でArrayBufferを保持

    // ( ... UIの初期設定 (スライダーリスナー) ... )
    generateButton.disabled = true;
    if(downloadButton) downloadButton.style.display = 'none';
    if (brightnessCompensationInput && brightnessCompensationValue) { /* ... */ }
    if (textureWeightInput && textureWeightValue) { /* ... */ }
    if (blendRangeInput && blendValue) { /* ... */ }
    if (edgeOpacityInput && edgeOpacityValue) { /* ... */ }


    // --- 1. タイルデータの初期ロード ---
    try {
        const t_json_load_start = performance.now();
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        
        if (!response.ok) { 
            throw new Error(`HTTP ${response.status} - ${response.statusText}`); 
        }
        
        tileData = await response.json();
        const t_json_load_end = performance.now();
        if(timingLog) timingLog.textContent += `\n[INIT] tile_data.json ロード: ${((t_json_load_end - t_json_load_start)/1000.0).toFixed(3)} 秒`;
        
        if (!tileData || !tileData.tileSets || !tileData.tileSets.thumb || !tileData.tiles || tileData.tiles.length === 0) {
             throw new Error('tile_data.jsonがスプライトシート形式ではありません。Analyzer Appで新しいデータを再生成してください。');
        }
        
        // ★ 修正: F2スプライトシートのロード
        const t_f2_load_start = performance.now();
        statusText.textContent = `ステータス: プレビュースプライトシート (${tileData.tileSets.thumb.sheetUrl}) をロード中...`;
        thumbSheetImage = new Image();
        
        // ★ 修正: F2ロード完了時に、F3プリロードを開始する
        thumbSheetImage.onload = () => {
            const t_f2_load_end = performance.now();
            if(timingLog) timingLog.textContent += `\n[INIT] F2スプライトシート ロード: ${((t_f2_load_end - t_f2_load_start)/1000.0).toFixed(3)} 秒`;

            statusText.textContent = `ステータス: プレビュー準備完了 (${tileData.tiles.length}タイル)。メイン画像を選択してください。`;
            if (mainImageInput) mainImageInput.disabled = false;
            
            // ★★★ 修正点: F2ロード完了と同時にF3プリロードを開始 ★★★
            startF3Preload(tileData);
        };
        thumbSheetImage.onerror = () => {
            statusText.textContent = `エラー: プレビュースプライトシート (${tileData.tileSets.thumb.sheetUrl}) のロードに失敗しました。`;
            console.error("Failed to load thumbnail sprite sheet.");
        };
        thumbSheetImage.src = tileData.tileSets.thumb.sheetUrl;

    } catch (error) {
        // ( ... エラーハンドリング (変更なし) ... )
        console.error("Initialization Error:", error); 
        if (error instanceof TypeError) {
             statusText.textContent = `エラー: ネットワーク接続に失敗しました (CORS or 接続拒否)。${error.message}`;
        } else if (error.message.includes('HTTP')) {
             statusText.textContent = `エラー: tile_data.json のロードに失敗しました (${error.message})。ファイルが正しい場所に配置されているか確認してください。`;
        } else {
             statusText.textContent = `エラー: tile_data.json の解析に失敗しました。ファイルが破損している可能性があります。${error.message}`;
        }
        return; 
    }
    
    // --- 2. メイン画像アップロード (推奨値/線画計算) ---
    if (mainImageInput) {
        mainImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                
                mainImage = new Image();
                mainImage.onload = () => {
                    const t_img_load_start = performance.now();
                    cachedResults = null;
                    lastHeavyParams = {};
                    generateButton.disabled = false;
                    if(downloadButton) downloadButton.style.display = 'none';
                    mainCanvas.width = mainImage.width;
                    mainCanvas.height = mainImage.height;
                    
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
                            
                            const t_img_load_end = performance.now();
                            if(timingLog) timingLog.textContent += `\n[IMG] 画像ロード+線画計算: ${((t_img_load_end - t_img_load_start)/1000.0).toFixed(3)} 秒`;

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

    // ( ... applyRecommendationsButton リスナー (変更なし) ... )
    if (applyRecommendationsButton) {
        applyRecommendationsButton.addEventListener('click', () => {
            if (!currentRecommendations) return;
            if (tileSizeInput) tileSizeInput.value = currentRecommendations.tileSize;
            if (brightnessCompensationInput) {
                brightnessCompensationInput.value = currentRecommendations.brightnessCompensation;
                if (brightnessCompensationValue) brightnessCompensationValue.textContent = currentRecommendations.brightnessCompensation;
            }
            if (textureWeightInput) {
                textureWeightInput.value = currentRecommendations.textureWeight;
                if (textureWeightValue) textureWeightValue.textContent = currentRecommendations.textureWeight;
            }
            if (blendRangeInput) {
                blendRangeInput.value = currentRecommendations.blendRange;
                if (blendValue) blendValue.textContent = currentRecommendations.blendRange;
            }
            if (edgeOpacityInput) {
                edgeOpacityInput.value = currentRecommendations.edgeOpacity;
                if (edgeOpacityValue) edgeOpacityValue.textContent = currentRecommendations.edgeOpacity;
            }
            statusText.textContent = 'ステータス: 推奨パラメータを適用しました。';
            cachedResults = null;
            lastHeavyParams = {};
            generateButton.disabled = false;
        });
    }

    function terminateWorkers() {
        workers.forEach(worker => worker.terminate());
        workers = [];
    }
    
    // ( ... runBatchedLoads (変更なし) ... )
    async function runBatchedLoads(loadPromises, maxConcurrency) {
        const running = [];
        const results = []; 
        for (const loadPromise of loadPromises) {
            const p = loadPromise().then(result => {
                running.splice(running.indexOf(p), 1);
                results.push(result);
                return result;
            });
            running.push(p);
            if (running.length >= maxConcurrency) {
                await Promise.race(running);
            }
        }
        return Promise.all(running);
    }
    
    // ★★★ 修正点: F3プリロード戦略 (Cプラン: メモリキャッシュ) ★★★
    function startF3Preload(tileData) {
        
        const fullSet = tileData.tileSets.full;
        const urlsToPreload = fullSet.sheetUrls;

        console.log(`[F3 Preload] F2ロード完了。${urlsToPreload.length}枚のF3スプライトシートのプリロードを開始します。`);
        
        t_f3_preload_start = performance.now(); // ★ 計測: T1 (F3 Preload Start)
        f3SheetCache.clear(); // 古いキャッシュをクリア
        
        const MAX_PRELOAD_CONCURRENCY = 10;
        
        const preloadTasks = urlsToPreload.map((url, index) => { // ★ index を取得
            return () => fetch(url, { mode: 'cors' }) 
                         .then(response => {
                             if (!response.ok) {
                                 throw new Error(`HTTP error ${response.status} for ${url}`);
                             }
                             return response.arrayBuffer(); // ★ 本体(Body)をダウンロード
                         })
                         .then(buffer => {
                             // ★ 修正点: ArrayBufferをグローバルMapに保存
                             f3SheetCache.set(index, buffer);
                             return buffer.byteLength; // ログ用にサイズを返す
                         })
                         .catch(err => console.warn(`[F3 Preload] プリロード失敗: ${url}`, err.message));
        });
        
        preloadPromise = runBatchedLoads(preloadTasks, MAX_PRELOAD_CONCURRENCY);
        
        if(timingLog) timingLog.textContent += `\n[F3 Preload] F3高画質シート (${urlsToPreload.length}枚) のバックグラウンドロード開始...`;
        
        preloadPromise.then((sizes) => {
            const t_f3_preload_end = performance.now();
            const totalSizeMB = sizes.reduce((acc, s) => acc + (s || 0), 0) / 1024 / 1024;
            if(timingLog) {
                timingLog.textContent += `\n[F3 Preload] F3全シートのバックグラウンドロード完了: ${((t_f3_preload_end - t_f3_preload_start)/1000.0).toFixed(3)} 秒 (${totalSizeMB.toFixed(2)} MB)`;
            }
        });
    }


    // --- 3. モザイク生成開始 (F1計算 + F2 Worker呼び出し) ---
    generateButton.addEventListener('click', async () => {
        if (!mainImage || !edgeCanvas || !thumbSheetImage.complete) {
            statusText.textContent = 'エラー: メイン画像またはスプライトシートが準備できていません。';
            return; 
        }
        // ★ 修正: Gプラン (F1, F2, F3 が個別に実行中かチェック)
        if (isGeneratingF1 || isGeneratingF2 || isGeneratingFullRes) {
            console.warn("[Button Click] 既に別の処理が実行中です。");
            return;
        }

        terminateWorkers(); // 古いWorkerをクリア
        generateButton.disabled = true;
        if (downloadButton) downloadButton.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        
        t_f1_click = performance.now(); // ★ 計測: T2 (F1 Click)
        
        // ( ... ログリセット (変更なし) ... )
        if (timingLog) {
            const envLog = timingLog.innerHTML.split('\n')[0]; 
            timingLog.innerHTML = envLog; 
        }

        // ( ... パラメータ取得 (変更なし) ... )
        const currentHeavyParams = {
            src: mainImage.src,
            tileSize: parseInt(tileSizeInput.value), 
            textureWeight: parseFloat(textureWeightInput.value) / 100.0 
        };
        const currentLightParams = {
            blendOpacity: parseInt(blendRangeInput.value),
            edgeOpacity: parseInt(edgeOpacityInput.value),
            brightnessCompensation: parseInt(brightnessCompensationInput.value)
        };
        
        const isTileSizeChanged = lastHeavyParams.tileSize !== currentHeavyParams.tileSize;
        
        // ★★★ 計測: F1/F2の入力パラメータをログ出力 (変更なし) ★★★
        if (timingLog) {
            timingLog.textContent += `\n--- [F1/F2 PARAMS] ---`;
            timingLog.textContent += `\n  - Image Size: ${mainImage.width}x${mainImage.height}`;
            timingLog.textContent += `\n  - Tile Size: ${currentHeavyParams.tileSize}`;
            timingLog.textContent += `\n  - Texture Weight: ${currentHeavyParams.textureWeight}`;
            timingLog.textContent += `\n  - Blend Opacity: ${currentLightParams.blendOpacity}`;
            timingLog.textContent += `\n  - Edge Opacity: ${currentLightParams.edgeOpacity}`;
            timingLog.textContent += `\n  - Brightness Comp: ${currentLightParams.brightnessCompensation}`;
            timingLog.textContent += `\n-----------------------`;
        }
        
        // 3. キャッシュのチェック
        if (!isTileSizeChanged && cachedResults && JSON.stringify(lastHeavyParams) === JSON.stringify(currentHeavyParams)) {
            
            // --- Case 1: 高速再描画 (F1スキップ) ---
            statusText.textContent = 'ステータス: F1計算は完了済み。F2描画のみ実行...';
            
            if (timingLog) {
                 timingLog.textContent += `\n[F1] (キャッシュ使用)`;
            }
            
            // ★ 修正: Gプラン (F2 Workerを直接呼び出す)
            await renderMosaicWithWorker(
                mainCanvas,
                currentLightParams
            );
            
            return; 
        }
        
        // --- Case 2: 通常処理 (F1 Worker処理を実行) ---
        cachedResults = null; 
        lastHeavyParams = currentHeavyParams; 
        statusText.textContent = 'ステータス: F1(計算) をWorkerで実行中...';
        isGeneratingF1 = true;
        
        const t_f1_start = performance.now(); 
        
        // F1計算用のImageDataを取得
        ctx.clearRect(0, 0, mainImage.width, mainImage.height);
        ctx.drawImage(mainImage, 0, 0); 
        const imageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height); 
        
        // ★ 修正: Gプラン (F1 Workerは1つだけ起動)
        const f1Worker = new Worker('mosaic_worker.js');
        workers.push(f1Worker);
        
        f1Worker.onmessage = async (e) => {
            if (e.data.type === 'f1_complete') {
                // --- F1 (計算) 完了 ---
                const t_f1_end = performance.now();
                cachedResults = true; // F1完了フラグ
                isGeneratingF1 = false;
                terminateWorkers(); // F1 Workerを解放
                
                // ★ 計測: F1完了ログ
                if(timingLog) {
                    timingLog.textContent += `\n[F1] Worker 配置計算: ${e.data.f1Time.toFixed(3)} 秒`;
                    timingLog.textContent += `\n[LOAD] Draw Tiles: ${e.data.drawTiles} 個`;
                    timingLog.textContent += `\n[LOAD] JSON Size (approx): ${e.data.jsonSizeKB.toFixed(0)} KB`;
                }

                statusText.textContent = 'ステータス: F1計算完了。F2プレビュー描画中...';
                if (progressBar) progressBar.style.width = '100%';
                
                // ★ 修正: Gプラン (F1完了後、F2 Workerを呼び出す)
                await renderMosaicWithWorker(
                    mainCanvas,
                    currentLightParams
                );
                
            } else if (e.data.type === 'status') {
                 statusText.textContent = `ステータス (F1 Worker): ${e.data.message}`;
            } else if (e.data.type === 'progress') {
                 if (progressBar) progressBar.style.width = `${e.data.progress * 100}%`;
            } else if (e.data.type === 'error') {
                 isGeneratingF1 = false;
                 generateButton.disabled = false;
                 statusText.textContent = `エラー: F1 Workerが失敗しました。 ${e.data.message}`;
                 terminateWorkers();
            }
        };
        
        f1Worker.onerror = (error) => {
             isGeneratingF1 = false;
             generateButton.disabled = false;
             console.error("F1 Worker Error:", error.message);
             statusText.textContent = `エラー: F1 Workerが失敗しました。 ${error.message}`;
             terminateWorkers();
        };
            
        // F1 Workerに処理を依頼
        f1Worker.postMessage({ 
            imageData: imageData, 
            tileData: tileData, 
            tileSize: currentHeavyParams.tileSize,
            width: mainImage.width,
            height: mainImage.height,
            brightnessCompensation: currentLightParams.brightnessCompensation,
            textureWeight: currentHeavyParams.textureWeight,
            startY: 0, // ★ Gプラン: 全範囲
            endY: mainImage.height // ★ Gプラン: 全範囲
        }, [imageData.data.buffer]);
    });

    // --- 4. F2プレビュー描画 (Worker) ---
    async function renderMosaicWithWorker(
        targetCanvas, 
        lightParams
    ) {
        // ★ 修正: F1実行中フラグとは別にF2実行中フラグを立てる
        if (isGeneratingF2) return; 
        isGeneratingF2 = true;
        generateButton.disabled = true; // F1/F2実行中はボタン無効
        
        const t_f2_start = performance.now(); 

        try {
            statusText.textContent = `ステータス: F2プレビューWorkerを起動中...`;
            
            // 1. F2 Bitmap準備
            const t_f2_bitmap_start = performance.now();
            const mainImageBitmap = await createImageBitmap(mainImage);
            const edgeImageBitmap = edgeCanvas ? await createImageBitmap(edgeCanvas) : null;
            const thumbSheetBitmap = await createImageBitmap(thumbSheetImage);
            const t_f2_bitmap_end = performance.now();
            
            statusText.textContent = `ステータス: F2プレビュー描画中... (Worker実行中)`;
            
            // ★ 修正: Gプラン (preview_worker.jsを起動)
            const previewWorker = new Worker('./preview_worker.js');
            workers.push(previewWorker);
            
            // 2. F2 Worker実行
            const t_f2_worker_start = performance.now();
            const workerPromise = new Promise((resolve, reject) => {
                previewWorker.onmessage = (e) => {
                    if (e.data.type === 'complete') {
                        const finalBitmap = e.data.bitmap;
                        const ctx = targetCanvas.getContext('2d');
                        
                        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
                        ctx.drawImage(finalBitmap, 0, 0);
                        finalBitmap.close(); 
                        
                        // ★ 計測: F2完了ログ
                        const t_f2_worker_end = performance.now();
                        if(timingLog) {
                            timingLog.textContent += `\n[F2] Worker 描画 (合計): ${e.data.totalTime.toFixed(3)} 秒`;
                            timingLog.textContent += `\n  - F2-A1 (DB Read): ${e.data.dbReadTime.toFixed(3)} 秒`;
                            timingLog.textContent += `\n  - F2-A2 (Tile Draw): ${e.data.tileTime.toFixed(3)} 秒`;
                            timingLog.textContent += `\n  - F2-B (Blend): ${e.data.blendTime.toFixed(3)} 秒`;
                            timingLog.textContent += `\n[F2] メインスレッド待機 (総時間): ${((t_f2_worker_end - t_f2_start)/1000.0).toFixed(3)} 秒`;
                            timingLog.textContent += `\n  - F2 (Bitmap準備): ${((t_f2_bitmap_end - t_f2_bitmap_start)/1000.0).toFixed(3)} 秒`;
                            timingLog.textContent += `\n  - F2 (Worker実行): ${((t_f2_worker_end - t_f2_worker_start)/1000.0).toFixed(3)} 秒`;
                        }
                        
                        resolve();
                    } else if (e.data.type === 'error') {
                        reject(new Error(e.data.message));
                    }
                    terminateWorkers(); // F2 Workerをクリア
                };
                previewWorker.onerror = (error) => {
                    reject(new Error(`F2 Worker error: ${error.message}`));
                    terminateWorkers(); // F2 Workerをクリア
                };
                
                // ★ 修正: Gプラン (JSONは渡さない)
                previewWorker.postMessage({
                    tileData: tileData,
                    // cachedResults: results, //渡さない
                    mainImageBitmap: mainImageBitmap,
                    edgeImageBitmap: edgeImageBitmap,
                    thumbSheetBitmap: thumbSheetBitmap,
                    width: mainImage.width,
                    height: mainImage.height,
                    lightParams: lightParams
                }, [mainImageBitmap, ...(edgeImageBitmap ? [edgeImageBitmap] : []), thumbSheetBitmap]); 
            });
            
            await workerPromise; 

            statusText.textContent = 'ステータス: モザイクアートが完成しました！';
            
        } catch (err) {
            statusText.textContent = `エラー: F2プレビュー描画に失敗しました。 ${err.message}`;
            console.error("F2 Preview Worker failed:", err);
        } finally {
            isGeneratingF2 = false;
            generateButton.disabled = false;
            if (downloadButton) downloadButton.style.display = 'block';
        }
    }

    // --- 5. ダウンロード機能 (F3) ---
    if (downloadButton) {
        
        const allDownloadParams = [resolutionScaleInput, jpegQualityInput];

        // ★★★ 修正点: F3ダウンロード (Cプラン + Gプラン) ★★★
        downloadButton.addEventListener('click', () => { 
            resetParameterStyles(allDownloadParams);
            
            // ★ 修正: Gプラン (F1, F2, F3 が個別に実行中かチェック)
            if (isGeneratingF1 || isGeneratingF2 || isGeneratingFullRes) {
                console.warn("[Button Click] 既に別の処理が実行中です。");
                return;
            } 
            // ★ 修正: Gプラン (F1完了フラグをチェック)
            if (!cachedResults || !mainImage) {
                 statusText.textContent = 'エラー: F1計算がまだ完了していません。';
                 return;
            }

            if (downloadWarningArea) downloadWarningArea.style.display = 'none';
            lastGeneratedBlob = null;
            
            // 1. UIを即座にロック
            isGeneratingFullRes = true;
            generateButton.disabled = true;
            downloadButton.disabled = true;
            if (downloadSpinner) downloadSpinner.style.display = 'inline-block';

            t_f3_click = performance.now(); // ★ 計測: T3 (F3 Click)

            // 2. プリロードが開始されたかチェック
            if (!preloadPromise) {
                 statusText.textContent = 'エラー: F3プリロードが開始されていません。';
                 isGeneratingFullRes = false;
                 generateButton.disabled = false;
                 downloadButton.disabled = false;
                 return;
            }

            statusText.textContent = 'ステータス: F3プリロードの完了を待機中... 完了次第、自動的にダウンロードを開始します。';
            
            const t_f3_wait_start = performance.now();
            
            // ★★★ 計測: F3パラメータとユーザー行動ログ (変更なし) ★★★
            const f3_scale = parseFloat(resolutionScaleInput.value);
            const f3_quality = parseInt(jpegQualityInput.value) / 100.0;
            if(timingLog) {
                timingLog.textContent += `\n--- [F3 PARAMS] ---`;
                timingLog.textContent += `\n  - Resolution Scale: ${f3_scale}`;
                timingLog.textContent += `\n  - JPEG Quality: ${f3_quality}`;
                timingLog.textContent += `\n  - [T1] F3 Preload Start: ${((t_f3_preload_start - t_app_start)/1000.0).toFixed(3)} 秒後`;
                timingLog.textContent += `\n  - [T2] F1 Click: ${((t_f1_click - t_app_start)/1000.0).toFixed(3)} 秒後`;
                timingLog.textContent += `\n  - [T3] F3 Click: ${((t_f3_click - t_app_start)/1000.0).toFixed(3)} 秒後`;
                timingLog.textContent += `\n-----------------------`;
            }
            
            // 3. プリロード完了後にF3 Workerを起動する「予約」を入れる
            preloadPromise.then(async () => {
                // --- ここからF3 Worker起動処理 (プリロード完了後に実行される) ---
                const t_f3_wait_end = performance.now();
                if(timingLog) {
                    timingLog.textContent += `\n[F3] メインスレッド: プリロード待機: ${((t_f3_wait_end - t_f3_wait_start)/1000.0).toFixed(3)} 秒`;
                }
                statusText.textContent = 'ステータス: プリロード完了。F3 Workerを起動します...';

                try {
                    const lightParams = {
                        blendOpacity: parseInt(blendRangeInput.value),
                        edgeOpacity: parseInt(edgeOpacityInput.value),
                        brightnessCompensation: parseInt(brightnessCompensationInput.value)
                    };

                    // F3 Bitmap準備 (メインスレッド)
                    const t_f3_bitmap_start = performance.now();
                    const mainImageBitmap = await createImageBitmap(mainImage);
                    const edgeImageBitmap = edgeCanvas ? await createImageBitmap(edgeCanvas) : null;
                    
                    // ★ 修正: Fプラン/FプランではF1計算用のImageDataは渡さない
                    
                    // ★★★ 修正点: Cプラン (ハイブリッド) ★★★
                    // 必要なArrayBufferをf3SheetCacheから抽出し、ImageBitmapに変換
                    const bitmapsToSend = new Map();
                    const transferList = [mainImageBitmap]; // ★ Fプラン: imageData転送を削除
                    if (edgeImageBitmap) transferList.push(edgeImageBitmap);
                    
                    let totalSendSize = 0;
                    const bitmapCreationPromises = [];
                    
                    // ★ 修正: Gプラン (F1の結果が不明なため、全シートをBitmap変換)
                    for (const [index, buffer] of f3SheetCache.entries()) {
                        if (buffer) {
                            totalSendSize += buffer.byteLength;
                            bitmapCreationPromises.push(
                                createImageBitmap(new Blob([buffer]))
                                    .then(bitmap => {
                                        bitmapsToSend.set(index, bitmap);
                                        transferList.push(bitmap); 
                                    })
                            );
                        } else {
                            console.warn(`[F3] Preload cache missing for sheet ${index}.`);
                        }
                    }
                    
                    await Promise.all(bitmapCreationPromises);
                    const t_f3_bitmap_end = performance.now();
                    
                    if(timingLog) timingLog.textContent += `\n[F3] メインスレッド: F3スプライトシート (Buffer to Bitmap): ${((t_f3_bitmap_end - t_f3_bitmap_start)/1000.0).toFixed(3)} 秒 (${(totalSendSize / 1024 / 1024).toFixed(2)} MB)`;
                    // ★★★ 修正点ここまで ★★★

                    statusText.textContent = 'ステータス: Workerに描画とエンコードを委譲中...';
                    
                    const downloadWorker = new Worker('./download_worker.js'); 
                    workers.push(downloadWorker);
                    
                    // F3 Worker実行
                    const t_f3_worker_start = performance.now();
                    const workerPromise = new Promise((resolve, reject) => {
                        downloadWorker.onmessage = (e) => {
                            if (e.data.type === 'complete') {
                                const t_f3_worker_end = performance.now();
                                
                                // ★ 計測: F3完了ログ
                                if (timingLog) {
                                    timingLog.textContent += `\n[F3] Worker 描画/エンコード総時間: ${e.data.totalTime.toFixed(3)} 秒`;
                                    // ★ 修正: Gプラン (F3-A1はDB Read)
                                    timingLog.textContent += `\n  - F3-A1 (DB Read): ${e.data.loadTime.toFixed(3)} 秒`;
                                    timingLog.textContent += `\n  - F3-A2 (Draw): ${e.data.renderTime.toFixed(3)} 秒`;
                                    timingLog.textContent += `\n  - F3-B (Encode): ${e.data.encodeTime.toFixed(3)} 秒 (${e.data.finalFileSizeMB.toFixed(2)} MB)`;
                                    
                                    timingLog.textContent += `\n[F3] メインスレッド待機 (総時間): ${((t_f3_worker_end - t_f3_wait_end)/1000.0).toFixed(3)} 秒`;
                                    timingLog.textContent += `\n  - F3 (Bitmap準備): ${((t_f3_bitmap_end - t_f3_bitmap_start)/1000.0).toFixed(3)} 秒`;
                                    timingLog.textContent += `\n  - F3 (Worker実行): ${((t_f3_worker_end - t_f3_worker_start)/1000.0).toFixed(3)} 秒`;
                                }
                                
                                const blob = new Blob([e.data.buffer], { type: e.data.mimeType });
                                resolve(blob);
                            } else if (e.data.type === 'error') {
                                reject(new Error(e.data.message));
                            }
                            terminateWorkers(); // F3 Workerをクリア
                        };
                        downloadWorker.onerror = (error) => {
                            reject(new Error(`Worker error: ${error.message}`));
                            terminateWorkers(); // F3 Workerをクリア
                        };
                        
                        // ★ 修正: Gプラン (CプランのBitmap + JSON無し)
                        downloadWorker.postMessage({
                            tileData: tileData, 
                            // cachedResults: cachedResults, // ★ Gプラン: 渡さない
                            sheetBitmaps: bitmapsToSend, // ★ Cプラン
                            
                            // ★ Fプラン: F1計算用のデータを渡さない
                            // imageData: imageData,
                            // tileSize: parseInt(tileSizeInput.value),
                            // textureWeight: parseFloat(textureWeightInput.value) / 100.0,
                            
                            mainImageBitmap: mainImageBitmap, 
                            edgeImageBitmap: edgeImageBitmap,
                            width: mainImage.width,
                            height: mainImage.height,
                            lightParams: lightParams,
                            scale: f3_scale, 
                            quality: f3_quality
                        }, transferList); // ★ ImageBitmapを転送
                    });
                    
                    const blob = await workerPromise;
                    
                    // ( ... ファイルサイズチェックと警告 (変更なし) ... )
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
                    isGeneratingFullRes = false;
                    generateButton.disabled = false;
                    if (downloadWarningArea.style.display !== 'block') {
                         downloadButton.disabled = false;
                    }
                }
            }); // --- .then() の予約処理ここまで ---
        });
    }

    // --- 6. 警告ボタンのリスナー (変更なし) ---
    if (warningYesButton && warningNoButton) {
        // ( ... 変更なし ... )
        const allDownloadParams = [resolutionScaleInput, jpegQualityInput];
        
        warningYesButton.addEventListener('click', () => {
            if (!lastGeneratedBlob) return;
            downloadWarningArea.style.display = 'none';
            resetParameterStyles(allDownloadParams);
            downloadBlob(lastGeneratedBlob, `photomosaic-${Date.now()}.jpg`);
            statusText.textContent = 'ステータス: 警告を無視してダウンロードを実行しました。';
            generateButton.disabled = false;
            downloadButton.disabled = false;
        });

        warningNoButton.addEventListener('click', () => {
            downloadWarningArea.style.display = 'none';
            resetParameterStyles(allDownloadParams); 
            const currentScale = parseFloat(resolutionScaleInput.value);
            const currentQuality = parseInt(jpegQualityInput.value);
            const newScale = Math.max(1.0, currentScale - 0.5); 
            const newQuality = Math.max(70, currentQuality - 10); 
            let advice = 'ダウンロードをキャンセルしました。15MBの制限を超えるため、以下のパラメータを変更し、再生成してください:\n';
            advice += ` - 💡 **解像度スケール**を現在の ${currentScale.toFixed(1)}x から **${newScale.toFixed(1)}x** に下げてみてください。（ファイルサイズへの影響が最大です）\n`;
            advice += ` - 📷 または **JPEG 品質**を現在の ${currentQuality}% から **${newQuality}%** に下げてみてください。\n`;
            statusText.textContent = advice;
            highlightParameter(resolutionScaleInput);
            highlightParameter(jpegQualityInput);
            generateButton.disabled = false;
            downloadButton.disabled = false;
        });
    }

});

// ( ... downloadBlobヘルパー関数 (変更なし) ... )
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100); 
}
