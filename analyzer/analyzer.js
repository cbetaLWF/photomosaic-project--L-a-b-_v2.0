document.addEventListener('DOMContentLoaded', () => {
    const dropArea = document.getElementById('drop-area');
    const startButton = document.getElementById('start-analysis');
    const downloadButton = document.getElementById('download-json-button');
    const logDiv = document.getElementById('log');
    let uploadedFiles = [];
    let generatedJsonData = null; // 生成されたJSONデータを保持する変数

    // 初期状態でダウンロードボタンを無効化
    downloadButton.disabled = true;

    // --- ドロップゾーンの設定 ---
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
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
            logDiv.textContent = `ログ: ${uploadedFiles.length}個の画像ファイルが選択されました。`;
            startButton.disabled = false;
            downloadButton.disabled = true; // 新しいファイルがアップロードされたら無効化
            generatedJsonData = null;
        } else {
            logDiv.textContent = 'ログ: 画像ファイルが見つかりません。';
            startButton.disabled = true;
        }
    }

    // --- 解析開始ボタン ---
    startButton.addEventListener('click', () => {
        if (uploadedFiles.length === 0) return;
        
        logDiv.textContent = 'ログ: 解析を開始します... (UIフリーズを防ぐためWorkerを使用)';
        startButton.disabled = true;
        downloadButton.disabled = true;
        
        try {
            // Workerを起動
            const worker = new Worker('worker.js');

            // Workerにファイルリストを送信
            worker.postMessage({ files: uploadedFiles });

            // Workerからのメッセージ受信
            worker.onmessage = (e) => {
                if (e.data.type === 'progress') {
                    const progress = Math.round(e.data.progress * 100);
                    logDiv.textContent = `進捗: ${progress}% - 処理中: ${e.data.fileName}`;
                    logDiv.scrollTop = logDiv.scrollHeight; 
                } else if (e.data.type === 'error') {
                    logDiv.textContent += `\nERROR: ${e.data.message}`;
                } else if (e.data.type === 'complete') {
                    generatedJsonData = e.data.results;
                    logDiv.textContent += `\n--- 解析完了 --- \n${generatedJsonData.length}個のタイルデータを生成しました。JSONダウンロードボタンを押してください。`;
                    
                    startButton.disabled = false;
                    downloadButton.disabled = false; // ダウンロードボタンを有効化
                    worker.terminate();
                }
            };

            worker.onerror = (error) => {
                logDiv.textContent += `\nWorkerエラー: ${error.message}`;
                startButton.disabled = false;
                worker.terminate();
            };
        } catch (error) {
            logDiv.textContent += `\nWorkerの起動エラー: ${error.message}`;
            startButton.disabled = false;
        }
    });

    // --- JSONダウンロードボタンのイベント ---
    downloadButton.addEventListener('click', () => {
        if (!generatedJsonData) {
            logDiv.textContent += '\nエラー: ダウンロードするデータがありません。先に解析を完了してください。';
            logDiv.scrollTop = logDiv.scrollHeight;
            return;
        }
        
        // JSONデータをBlobとして作成
        const jsonContent = JSON.stringify(generatedJsonData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        
        // Blob URLを作成
        const url = URL.createObjectURL(blob);
        
        // ダウンロード用の非表示リンクを作成し、プログラム的にクリック
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tile_data.json';
        
        // DOMに一時的に追加し、クリックして削除
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Blob URLを解放 (メモリリーク防止)
        URL.revokeObjectURL(url);
        
        // ユーザーへの指示をログに追加
        logDiv.textContent += '\n\n✅ tile_data.json のダウンロードを開始しました。\n★重要★: ダウンロードしたJSONファイルを Mosaic Appのルートに配置し、タイル画像はリネームせず /tiles フォルダに移動させてください。';
        logDiv.scrollTop = logDiv.scrollHeight;
    });
});
