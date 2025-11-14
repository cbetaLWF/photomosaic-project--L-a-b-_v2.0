// ( ... 変更なし: applySobelFilter, analyzeImageAndGetRecommendations ... )
function applySobelFilter(imageData) { /* ... */ }
function analyzeImageAndGetRecommendations(image, analysisImageData) { /* ... */ }


document.addEventListener('DOMContentLoaded', async () => {
    // --- UI要素の取得 ---
    // ( ... 変更なし: mainImageInput, generateButton, mainCanvas, etc ... )
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const blendValue = document.getElementById('blend-value');
    const edgeOpacityInput = document.getElementById('edge-opacity-range');
    const edgeOpacityValue = document.getElementById('edge-opacity-value');
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    const textureWeightInput = document.getElementById('texture-weight');
    const textureWeightValue = document.getElementById('texture-weight-value');
    const recommendationArea = document.getElementById('recommendation-area');
    const applyRecommendationsButton = document.getElementById('apply-recommendations-button');
    const recTileSize = document.getElementById('rec-tile-size');
    const recBrightness = document.getElementById('rec-brightness');
    const recTextureWeight = document.getElementById('rec-texture-weight');
    const recBlendRange = document.getElementById('rec-blend-range');
    const recEdgeOpacity = document.getElementById('rec-edge-opacity');
    const previewModeCheckbox = document.getElementById('preview-mode-checkbox');

    // ★ 変更点: ダウンロードと警告のUI
    const downloadSpinner = document.getElementById('download-spinner');
    const downloadWarningArea = document.getElementById('download-warning-area');
    const downloadWarningMessage = document.getElementById('download-warning-message');
    const warningYesButton = document.getElementById('warning-yes-button');
    const warningNoButton = document.getElementById('warning-no-button');
    const resolutionScaleInput = document.getElementById('resolution-scale');
    const jpegQualityInput = document.getElementById('jpeg-quality');
    
    // ( ... 必須要素チェック (更新) ... )
    if (!mainCanvas || !statusText || !generateButton || !mainImageInput || !tileSizeInput || !previewModeCheckbox || !recommendationArea || !downloadWarningArea || !resolutionScaleInput || !jpegQualityInput) {
        console.error("Initialization Error: One or more critical HTML elements are missing.");
        document.body.innerHTML = "<h1>Initialization Error</h1><p>The application failed to load because critical elements are missing from the HTML.</p>";
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
    let isPreviewRender = true; 
    let isGeneratingFullRes = false; 

    // ★ 変更点: 15MB超過のBlobを一時保存
    let lastGeneratedBlob = null; 


    // --- UIの初期設定 ---
    // ( ... 変更なし: スライダーリスナー ... )
    // ( ... 1. タイルデータの初期ロード ... )
    // ( ... 2. メイン画像アップロード (推奨値/線画計算) ... )
    // ( ... applyRecommendationsButton リスナー ... )
    // ( ... terminateWorkers ヘルパー関数 ... )
    // ( ... 3. モザイク生成開始 (キャッシュ機能) ... )
    // ( ... (generateButton.addEventListener) ... )

    /* ====================================================================
       変更がないため、 1 - 3 のコード (DOMContentLoaded, スライダー, 
       タイルロード, 画像アップロード, 推奨値適用, worker起動) は
       前回のコード (Cache Feature) と同一です。
       
       ... (前回の main.js の 1行目〜300行目あたりまで変更なし) ...
       
       変更点は、renderMosaic と downloadButton リスナーのみです。
       ====================================================================
    */

    // ( ... (1-3) 変更のないコードは省略 ... )
    // ( ... applySobelFilter, analyzeImageAndGetRecommendations, ... )
    // ( ... DOMContentLoaded, UI取得, スライダーリスナー, ... )
    // ( ... 1. タイルデータロード, 2. 画像アップロード, ... )
    // ( ... applyRecommendationsButton, terminateWorkers, ... )
    // ( ... 3. generateButton.addEventListener ... )


    // --- 4. 最終的なモザイクの描画 ---
    // ★ 変更点: `scale`引数を追加し、描画Canvasを受け取るように変更
    async function renderMosaic(
        targetCanvas, // 描画対象のCanvas (mainCanvas または highResCanvas)
        results, 
        width, // 元画像の幅
        height, // 元画像の高さ
        blendOpacity, 
        edgeOpacity, 
        brightnessCompensation, 
        isPreview = true,
        scale = 1.0 // ★ 解像度スケール
    ) {
        
        isPreviewRender = isPreview; // 現在の描画モードを保存

        // ★ 変更点: スケールを適用したCanvasサイズ
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
                    // ( ... 明度補正(finalBrightness)の計算 ... )
                    let targetL = tile.targetL; 
                    let tileL = tile.tileL; 
                    if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
                    let brightnessRatio = targetL / tileL; 
                    if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
                        brightnessRatio = MAX_BRIGHTNESS_RATIO;
                    }
                    const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
                    ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;

                    // ( ... クロップ/反転ロジック (変更なし) ... )
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
                    
                    // ★ 変更点: 描画先の座標とサイズに scale を適用
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
                img.onerror = () => { /* ... (変更なし: サムネイル/フル解像度のフォールバック) ... */ };
                
                // ( ... 変更なし: isPreviewに応じてURL切り替え ... )
                img.src = (isPreview && tile.thumb_url) ? tile.thumb_url : tile.url;
            });
            promises.push(p);
        }

        await Promise.all(promises);
        
        ctx.restore(); // クリッピングを解除

        progressBar.style.width = '100%';
        statusText.textContent = 'ステータス: タイル描画完了。ブレンド処理中...';

        // ( ... 変更なし: 2段階ブレンド処理 ... )
        // ★ 変更点: 描画サイズに scale を適用
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
        
        // ★ 変更点: プレビュー描画時のみ、ボタンを有効化
        if (isPreview) {
            generateButton.disabled = false;
            downloadButton.style.display = 'block';
        }
    }

    // ★ 変更点: ダウンロード処理を独立した関数に
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

    // --- 5. ダウンロード機能 (★ 全面改修) ---
    downloadButton.addEventListener('click', async () => {
        if (isGeneratingFullRes) return; // 二重実行防止
        if (!cachedResults) {
            statusText.textContent = 'エラー: まず「モザイク生成」を実行してください。';
            return;
        }

        // 警告エリアを非表示にし、Blobをリセット
        downloadWarningArea.style.display = 'none';
        lastGeneratedBlob = null;
        
        try {
            isGeneratingFullRes = true;
            generateButton.disabled = true;
            downloadButton.disabled = true;
            downloadSpinner.style.display = 'inline';
            statusText.textContent = 'ステータス: 高画質版を生成中... (時間がかかります)';

            // 1. 現在のスライダー値を取得
            const lightParams = {
                blendOpacity: parseInt(blendRangeInput.value),
                edgeOpacity: parseInt(edgeOpacityInput.value),
                brightnessCompensation: parseInt(brightnessCompensationInput.value)
            };
            const scale = parseFloat(resolutionScaleInput.value);
            const quality = parseInt(jpegQualityInput.value) / 100.0; // 0.7 - 1.0

            // 2. メインCanvasを高画質版で再描画 (フェーズ3)
            await renderMosaic(
                mainCanvas, // ★ メインCanvasを直接使う
                cachedResults, 
                mainImage.width, 
                mainImage.height, 
                lightParams.blendOpacity, 
                lightParams.edgeOpacity, 
                lightParams.brightnessCompensation,
                false, // ★ 高画質モード (isPreview=false)
                scale  // ★ 解像度スケール
            );
            
            statusText.textContent = 'ステータス: 高画質版をJPEGに変換中...';

            // 3. CanvasからJPEG Blobを生成
            const blob = await new Promise(resolve => {
                mainCanvas.toBlob(resolve, 'image/jpeg', quality);
            });

            // 4. ファイルサイズをチェック (15MB)
            const fileSizeMB = blob.size / 1024 / 1024;
            const limitMB = 15;

            if (fileSizeMB <= limitMB) {
                // 15MB以下: 即座にダウンロード
                statusText.textContent = `ステータス: 高画質版 ( ${fileSizeMB.toFixed(1)} MB) の準備完了。`;
                downloadBlob(blob, `photomosaic-${Date.now()}.jpg`);
            } else {
                // 15MB超過: ★ 警告を表示
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
            downloadSpinner.style.display = 'none';
        }
    });

    // ★ 変更点: 警告Yes/Noボタンのリスナー
    warningYesButton.addEventListener('click', () => {
        if (lastGeneratedBlob) {
            statusText.textContent = 'ステータス: 15MB超過のファイルをダウンロードします...';
            downloadBlob(lastGeneratedBlob, `photomosaic-large-${Date.now()}.jpg`);
        }
        lastGeneratedBlob = null;
        downloadWarningArea.style.display = 'none';
    });
    
    warningNoButton.addEventListener('click', () => {
        lastGeneratedBlob = null;
        downloadWarningArea.style.display = 'none';
        statusText.textContent = 'ステータス: ダウンロードをキャンセルしました。';
    });

});
