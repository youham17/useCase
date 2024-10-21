import { test, expect } from '@playwright/test';
import * as fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import * as path from 'path';
import stringSimilarity from 'string-similarity';
import * as diff from 'diff';

test('0001 - comparaison rapports', async ({ page, context }) => {
    // Créer le dossier downloads s'il n'existe pas
    await fs.mkdir(path.join(__dirname, 'downloads'), { recursive: true });

    // Processus de Login
    await page.goto('https://acceptation-1-logic-membre.cogiweb.com/Logic/SYS/Login');
    await page.fill('#UserName', 'cogitest');
    await page.fill('#Hash', 'Cogiweb3740*');
    await page.click('#btnLogin');
    await page.waitForSelector('#btnLogin', { state: 'visible' });
    await page.click('#btnLogin');

    // Navigation vers l'écran
    let frame = page.frameLocator('#subMenu');
    await frame.locator('xpath=//span[@class="homeMenuImg menu-iconbutton cogifont cogi-GrandLivre"]').click();
    await page.waitForTimeout(1000);
    await frame.locator('a').filter({ hasText: 'Plan comptable' }).click();

    // Cliquer sur le bouton Imprimer et attendre que le rapport soit chargé
    const printButton = frame.getByRole('button', { name: 'Imprimer' });
    await printButton.waitFor({ state: 'visible' });
    await printButton.click();
    // Attendre que la nouvelle page soit chargée
    const newPage = await context.waitForEvent('page');
    await newPage.waitForLoadState('networkidle');

    // Cliquer sur le menu d'exportation et sélectionner PDF
    await newPage.frameLocator('iframe[name="displayFrame"]').getByLabel('Export To').locator('div').nth(4).click();

    // Attendre le téléchargement du fichier
    const [download] = await Promise.all([
        newPage.waitForEvent('download'),
        newPage.frameLocator('iframe[name="displayFrame"]').getByTitle('PDF', { exact: true }).click()
    ]);

    // Lire le contenu du fichier téléchargé
    const downloadedBuffer = await download.createReadStream().then(stream => {
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    });

    // Sauvegarder le contenu dans un fichier local
    const generatedPdfPath = path.join(__dirname, 'downloads', 'rapport_genere.pdf');
    await fs.writeFile(generatedPdfPath, downloadedBuffer);

    // Comparer les fichiers PDF
    const referencePdfPath = path.join(__dirname, 'downloads', 'rapport_reference.pdf');
    const { isEqual, similarity } = await comparePDFs(generatedPdfPath, referencePdfPath);

    console.log(`Similarité des PDFs: ${similarity}`);
    expect(isEqual, `Les PDFs ne sont pas suffisamment similaires. Similarité: ${similarity}`).toBe(true);

    console.log("La comparaison des rapports est terminée avec succès.");

    // Fermer la nouvelle page
    await newPage.close();
});

async function comparePDFs(file1Path: string, file2Path: string): Promise<{ isEqual: boolean, similarity: number }> {
    const data1 = await fs.readFile(file1Path);
    const data2 = await fs.readFile(file2Path);
    
    const pdf1 = await pdfParse(data1);
    const pdf2 = await pdfParse(data2);
    
    const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
    
    const normalizedText1 = normalizeText(pdf1.text);
    const normalizedText2 = normalizeText(pdf2.text);
    
    const removeDates = (text: string) => text.replace(/\d{2}\/\d{2}\/\d{4}/g, 'DATE');
    
    const finalText1 = removeDates(normalizedText1);
    const finalText2 = removeDates(normalizedText2);
    
    const similarity = stringSimilarity.compareTwoStrings(finalText1, finalText2);
    const isEqual = similarity > 0.95;

    if (!isEqual) {
        console.log("Différences trouvées après normalisation et suppression des dates.");
        
        const differences = diff.diffWords(finalText1, finalText2);
        
        let differencesLog = "Rapport de comparaison des PDFs\n";
        differencesLog += "==============================\n\n";
        differencesLog += `Date de comparaison: ${new Date().toLocaleString()}\n`;
        differencesLog += `Fichier 1: ${path.basename(file1Path)}\n`;
        differencesLog += `Fichier 2: ${path.basename(file2Path)}\n`;
        differencesLog += `Similarité: ${(similarity * 100).toFixed(2)}%\n\n`;
        differencesLog += "Légende:\n";
        differencesLog += "  [-] Texte supprimé\n";
        differencesLog += "  [+] Texte ajouté\n";
        differencesLog += "  [ ] Texte inchangé\n\n";
        differencesLog += "Détails des différences:\n";
        differencesLog += "========================\n\n";

        let lineNumber = 1;
        let currentLine = "";
        const maxLineLength = 80;
        let changeCount = { 
            addedWords: 0, 
            removedWords: 0, 
            unchangedWords: 0,
            addedLines: 0,
            removedLines: 0,
            unchangedLines: 0
        };

        differences.forEach((part) => {
            const prefix = part.added ? '[+]' : part.removed ? '[-]' : '[ ]';
            const words = part.value.split(/\s+/).filter(word => word.length > 0);
            const lines = part.value.split('\n');

            words.forEach((word) => {
                if (currentLine.length + word.length + 1 > maxLineLength) {
                    differencesLog += `${lineNumber.toString().padStart(4, ' ')} ${currentLine}\n`;
                    lineNumber++;
                    currentLine = "";
                }
                if (currentLine === "") {
                    currentLine = prefix + ' ' + word;
                } else {
                    currentLine += ' ' + word;
                }
            });

            if (part.added) {
                changeCount.addedWords += words.length;
                changeCount.addedLines += lines.length;
            } else if (part.removed) {
                changeCount.removedWords += words.length;
                changeCount.removedLines += lines.length;
            } else {
                changeCount.unchangedWords += words.length;
                changeCount.unchangedLines += lines.length;
            }
        });

        if (currentLine !== "") {
            differencesLog += `${lineNumber.toString().padStart(4, ' ')} ${currentLine}\n`;
        }

        const totalWords = changeCount.addedWords + changeCount.removedWords + changeCount.unchangedWords;
        const totalLines = changeCount.addedLines + changeCount.removedLines + changeCount.unchangedLines;

        differencesLog += "\nRésumé des changements:\n";
        differencesLog += "=======================\n";
        differencesLog += `Mots ajoutés: ${changeCount.addedWords}\n`;
        differencesLog += `Mots supprimés: ${changeCount.removedWords}\n`;
        differencesLog += `Mots inchangés: ${changeCount.unchangedWords}\n`;
        differencesLog += `Lignes ajoutées: ${changeCount.addedLines}\n`;
        differencesLog += `Lignes supprimées: ${changeCount.removedLines}\n`;
        differencesLog += `Lignes inchangées: ${changeCount.unchangedLines}\n`;
        differencesLog += `Total des mots: ${totalWords}\n`;
        differencesLog += `Total des lignes: ${totalLines}\n`;
        differencesLog += `Pourcentage de mots modifiés: ${((changeCount.addedWords + changeCount.removedWords) / totalWords * 100).toFixed(2)}%\n`;
        differencesLog += `Pourcentage de lignes modifiées: ${((changeCount.addedLines + changeCount.removedLines) / totalLines * 100).toFixed(2)}%\n`;

        await fs.writeFile(path.join(__dirname, 'downloads', 'rapport_differences.txt'), differencesLog);
        console.log("Un fichier 'rapport_differences.txt' a été créé dans le dossier 'downloads' pour une analyse détaillée.");
    }
    
    return { isEqual, similarity };
}