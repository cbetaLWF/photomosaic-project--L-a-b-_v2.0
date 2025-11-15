document.addEventListener('DOMContentLoaded', () => {
    // UI要素の取得
    const dropArea = document.getElementById('drop-area');
    const startButton = document.getElementById('start-analysis');
    const downloadButton = document.getElementById('download-zip-button'); 
    const logDiv = document.getElementById('log');
    const qualitySlider = document.getElementById('thumbnail-quality');
    const sizeSlider = document.getElementById('thumbnail-size'); 
    
    let uploadedFiles = [];
    let analysisResults = null; // ★ 構造変更: { json: {}, spriteSheets: [] }

    // --- ドロップゾーンの設定 ---
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('active'), false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('active'), false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    dropArea.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        // 画像ファイルのみをフィルタリング
        uploadedFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (uploadedFiles.length > 0) {
            logDiv.textContent = `ログ: ${uploadedFiles.length}個の画像ファイルが選択されました。\nファイル名はそのまま使用されます。`;
            startButton.disabled = false;
            downloadButton.disabled = true; 
            analysisResults = null;
        } else {
            logDiv.textContent = 'ログ: 画像ファイルが見つかりません。';
            startButton.disabled = true;
            downloadButton.disabled = true;
        }
    }

    // --- 解析開始ボタン ---
    startButton.addEventListener('click', () => {
        if (uploadedFiles.length === 0) return;
        
        logDiv.textContent = 'ログ: 解析とスプライトシート生成を開始します... (Workerを使用)';
        startButton.disabled = true;
        downloadButton.disabled = true;
        analysisResults = null;
        
        // Workerを起動
        const worker = new Worker('worker.js');

        // ★ 変更点: thumbnailSizeは F2 (Thumb) の幅として流用 (例: 320)
        // ★ thumbnailQuality は F2/F3両方のスプライトシートの品質として流用
        const thumbnailQuality = parseInt(qualitySlider.value) / 100.0; // 0.0 - 1.0
        const thumbnailSize = parseInt(sizeSlider.value); // F2 width (320)

        // Workerにファイルリストと設定を送信
        worker.postMessage({ 
            files: uploadedFiles,
            thumbnailQuality: thumbnailQuality,
            thumbnailSize: thumbnailSize 
        });

        // Workerからのメッセージ受信
        worker.onmessage = (e) => {
            if (e.data.type === 'progress') {
                const progress = Math.round(e.data.progress * 100);
                logDiv.textContent = `進捗: ${progress}% - 処理中: ${e.data.fileName}`;
            } else if (e.data.type === 'error') {
                logDiv.textContent += `\nERROR: ${e.data.message}`;
            } else if (e.data.type === 'complete') {
                // ★ 修正: JSONオブジェクトとスプライトシートBlob配列を受け取る
                analysisResults = e.data.results; 
                
                logDiv.textContent = `\n--- 解析完了 --- \n${analysisResults.json.tiles.length}個のタイルデータを解析し、${analysisResults.spriteSheets.length}枚のスプライトシートを生成しました。\nZIPダウンロードボタンを押してください。`;
                
                downloadButton.disabled = false;
                startButton.disabled = false;
                worker.terminate();
            }
        };

        worker.onerror = (error) => {
            logDiv.textContent += `\nWorkerエラー: ${error.message}`;
            startButton.disabled = false;
            worker.terminate();
        };
    });

    // --- ZIPダウンロードボタン ---
    downloadButton.addEventListener('click', async () => {
        if (!analysisResults) {
            logDiv.textContent += '\nエラー: 解析データがまだ生成されていません。';
            return;
        }
        
        logDiv.textContent += '\nZIPファイルを生成中です... (ファイル数が多いと時間がかかります)';
        
        try {
            // JSZipのインスタンスを作成
            const zip = new JSZip();

            // 1. JSONデータをZIPに追加 (tile_data.json)
            const jsonContent = JSON.stringify(analysisResults.json, null, 2);
            zip.file('tile_data.json', jsonContent);

            // 2. ★ 修正: スプライトシート画像をZIPに追加 (sprites/ フォルダ内)
            const spriteFolder = zip.folder('sprites');
            analysisResults.spriteSheets.forEach(sheet => {
                // sheet.path は "sprites/thumb_sheet.jpg" や "sprites/full_sheet_0.jpg"
                // .replace()でフォルダ名を除去し、ファイル名だけにする
                const fileName = sheet.path.replace('sprites/', '');
                spriteFolder.file(fileName, sheet.blob);
            });

            // 3. ZIPファイルをBlobとして生成
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: {
                    level: 9 // 最大圧縮
                }
            });

            // 4. Blob URLを生成し、ダウンロードを実行
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'photomosaic_data.zip';
            
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(url); // オブジェクトURLを解放
            
            logDiv.textContent += '\n★完了★ photomosaic_data.zip をダウンロードしました。\n次に、このZIPファイルを展開し、中身を /mosaic/ フォルダに配置してください。\n(tile_data.json と sprites フォルダをそのままコピー)';
            downloadButton.disabled = true;

        } catch (error) {
            logDiv.textContent += `\nZIP生成エラー: ${error.message}`;
            console.error("ZIP generation failed:", error);
        }
    });
});
