import { test, expect } from '@playwright/test';
import * as fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import * as path from 'path';
import stringSimilarity from 'string-similarity';
import * as diff from 'diff';

// Configuration du test
const CONFIG = {
    SEUIL_SIMILARITE: 0.95,
    LOGIN_URL: 'https://acceptation-1-logic-membre.cogiweb.com/Logic/SYS/Login',
    CREDENTIALS: {
        username: 'cogitest',
        password: 'Cogiweb3740*'
    }
};

// Fonctions utilitaires
async function creerDossierDownloads() {
    await fs.mkdir(path.join(__dirname, 'downloads'), { recursive: true });
}

async function naviguerVersRapport(page: any, nomRapport: string) {
    let cadre = page.frameLocator('#subMenu');
    await cadre.locator('xpath=//span[@class="homeMenuImg menu-iconbutton cogifont cogi-GrandLivre"]').click();
    await page.waitForTimeout(1000);
    await cadre.locator('a').filter({ hasText: nomRapport }).click();

    const boutonImprimer = cadre.getByRole('button', { name: 'Imprimer' });
    await boutonImprimer.waitFor({ state: 'visible' });
    await boutonImprimer.click();
}

async function gererComparaisonRapport(page: any, context: any, nomRapport: string) {
    const nouvellePage = await context.waitForEvent('page');
    await nouvellePage.waitForLoadState('networkidle');

    await nouvellePage.frameLocator('iframe[name="displayFrame"]').getByLabel('Export To').locator('div').nth(4).click();

    const [telechargement] = await Promise.all([
        nouvellePage.waitForEvent('download'),
        nouvellePage.frameLocator('iframe[name="displayFrame"]').getByTitle('PDF', { exact: true }).click()
    ]);

    const contenuBuffer = await telechargement.createReadStream().then(stream => {
        return new Promise<Buffer>((resolve, reject) => {
            const morceaux: Buffer[] = [];
            stream.on('data', (morceau) => morceaux.push(Buffer.from(morceau)));
            stream.on('end', () => resolve(Buffer.concat(morceaux)));
            stream.on('error', reject);
        });
    });

    const cheminRapportGenere = path.join(__dirname, 'downloads', `rapport_genere_${nomRapport}.pdf`);
    await fs.writeFile(cheminRapportGenere, contenuBuffer);

    const cheminRapportReference = path.join(__dirname, 'downloads', `rapport_reference_${nomRapport}.pdf`);
    const { estIdentique, similarite } = await comparerPDFs(cheminRapportGenere, cheminRapportReference);

    console.log(`Similarité des PDFs: ${(similarite * 100).toFixed(2)}%\n`);
    expect(estIdentique, `Les PDFs ne sont pas suffisamment similaires. Similarité: ${(similarite * 100).toFixed(2)}%\n\n`).toBe(true);

    if (estIdentique) {
        console.log(`La comparaison du rapport '${nomRapport}' a réussi. Les fichiers sont identiques.`);
    } else {
        console.log(`Des différences ont été trouvées dans le rapport '${nomRapport}'.`);
    }

    await nouvellePage.close();
    return { estIdentique, similarite };
}


async function comparerPDFs(chemin1: string, chemin2: string): Promise<{ estIdentique: boolean, similarite: number }> {
    const donnees1 = await fs.readFile(chemin1);
    const donnees2 = await fs.readFile(chemin2);
    
    const pdf1 = await pdfParse(donnees1);
    const pdf2 = await pdfParse(donnees2);
    
    const normaliserTexte = (texte: string) => texte.replace(/\s+/g, ' ').trim().toLowerCase();
    const supprimerDates = (texte: string) => texte.replace(/\d{2}\/\d{2}\/\d{4}/g, 'DATE');
    
    const texteTraite1 = supprimerDates(normaliserTexte(pdf1.text));
    const texteTraite2 = supprimerDates(normaliserTexte(pdf2.text));
    
    const similarite = stringSimilarity.compareTwoStrings(texteTraite1, texteTraite2);
    const estIdentique = similarite > CONFIG.SEUIL_SIMILARITE;

    if (!estIdentique) {
        console.log("Différences trouvées après normalisation et suppression des dates.\n\n");
        await genererRapportDifferences(texteTraite1, texteTraite2, similarite, chemin1, chemin2);
    }
    
    return { estIdentique, similarite };
}

async function genererRapportDifferences(texte1: string, texte2: string, similarite: number, chemin1: string, chemin2: string) {
    const differences = diff.diffWords(texte1, texte2);

    let rapportDifferences = "Rapport de comparaison des rapports PDFs\n";
    rapportDifferences += "==============================\n\n";
    rapportDifferences += `Date de comparaison: ${new Date().toLocaleString()}\n`;
    rapportDifferences += `Fichier 1: ${path.basename(chemin1)}\n`;
    rapportDifferences += `Fichier 2: ${path.basename(chemin2)}\n`;
    rapportDifferences += `Similarité: ${(similarite * 100).toFixed(2)}%\n\n`;

    // Légende
    rapportDifferences += "Légende:\n";
    rapportDifferences += "  [-] Texte supprimé\n";
    rapportDifferences += "  [+] Texte ajouté\n";
    rapportDifferences += "  [ ] Texte inchangé\n\n";
    rapportDifferences += "Détails des différences:\n";
    rapportDifferences += "========================\n\n";

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
                rapportDifferences += `${lineNumber.toString().padStart(4, ' ')} ${currentLine}\n`;
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
        rapportDifferences += `${lineNumber.toString().padStart(4, ' ')} ${currentLine}\n`;
    }

    const totalWords = changeCount.addedWords + changeCount.removedWords + changeCount.unchangedWords;
    const totalLines = changeCount.addedLines + changeCount.removedLines + changeCount.unchangedLines;

    rapportDifferences += "\nRésumé des changements:\n";
    rapportDifferences += "=======================\n";
    rapportDifferences += `Mots ajoutés: ${changeCount.addedWords}\n`;
    rapportDifferences += `Mots supprimés: ${changeCount.removedWords}\n`;
    rapportDifferences += `Mots inchangés: ${changeCount.unchangedWords}\n`;
    rapportDifferences += `Lignes ajoutées: ${changeCount.addedLines}\n`;
    rapportDifferences += `Lignes supprimées: ${changeCount.removedLines}\n`;
    rapportDifferences += `Lignes inchangées: ${changeCount.unchangedLines}\n`;
    rapportDifferences += `Total des mots: ${totalWords}\n`;
    rapportDifferences += `Total des lignes: ${totalLines}\n`;
    rapportDifferences += `Pourcentage de mots modifiés: ${((changeCount.addedWords + changeCount.removedWords) / totalWords * 100).toFixed(2)}%\n`;
    rapportDifferences += `Pourcentage de lignes modifiées: ${((changeCount.addedLines + changeCount.removedLines) / totalLines * 100).toFixed(2)}%\n`;

    await fs.writeFile(
        path.join(__dirname, 'downloads', `differences_${path.basename(chemin1, '.pdf')}.txt`),
        rapportDifferences
    );

    console.log("Un fichier 'rapport_differences.txt' a été créé dans le dossier 'downloads' pour une analyse détaillée.\n\n");
}



// Configuration des tests
test.beforeEach(async ({ page }) => {
    await page.goto(CONFIG.LOGIN_URL);
    await page.fill('#UserName', CONFIG.CREDENTIALS.username);
    await page.fill('#Hash', CONFIG.CREDENTIALS.password);
    await page.click('#btnLogin');
    await page.waitForSelector('#btnLogin', { state: 'visible' });
    await page.click('#btnLogin');
    
    await creerDossierDownloads();
});

// Tests
test('0001 - comparaison Plan comptable', async ({ page, context }) => {
    await naviguerVersRapport(page, 'Plan comptable');
    await gererComparaisonRapport(page, context, 'PlanComptable');
});

test('0002 - comparaison Journal GL', async ({ page, context }) => {
    await naviguerVersRapport(page, 'Journal GL');
    await gererComparaisonRapport(page, context, 'JournalGL');
});

test('0003 - Bilan', async ({ page, context }) => {
    await naviguerVersRapport(page, 'Bilan');
    await gererComparaisonRapport(page, context, 'Bilan');
});