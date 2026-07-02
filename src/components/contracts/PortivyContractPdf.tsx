import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#ffffff',
    paddingTop: 30,
    paddingBottom: 30,
    paddingLeft: 85,
    paddingRight: 85,
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    lineHeight: 1.3,
  },
  headerBox: {
    marginBottom: 20,
    textAlign: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
  },
  address: {
    fontSize: 9.5,
    marginTop: 2,
  },
  section: {
    marginBottom: 8,
  },
  bold: {
    fontWeight: 'bold',
    fontFamily: 'Helvetica-Bold',
  },
  h2: {
    fontSize: 9.5,
    fontWeight: 'bold',
    fontFamily: 'Helvetica-Bold',
    marginTop: 12,
    marginBottom: 4,
  },
  rowFlex: {
    flexDirection: 'row',
  },
  label: {
    width: 80,
  },
  value: {
    flex: 1,
  },
  bulletItem: {
    marginLeft: 20,
  },
  signatureContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 30,
  },
  underline: {
    textDecoration: 'underline',
  },
  divider: {
    borderBottom: '0.5pt solid #94a3b8',
    marginVertical: 4,
  }
});

export interface ContractData {
  locataireNom: string;
  locataireAdresse: string;
  locataireTel: string;
  locataireEmail: string;
  dateDebut: string; 
  dateFin: string;   
  loyerMontant: number;     
  montantTotal: number;     
  datePaiement: string;     
  cautionMontant: number;   
  nbAdultes: string;        
  nbEnfants: string;        
  dateSignature: string;
  lieuSignature: string;
  menageMontant: number;    
  acompteMontant: number;
}

interface Props {
  data: ContractData;
}

export const PortivyContractPdf: React.FC<Props> = ({ data }) => {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        
        <View style={styles.headerBox}>
          <Text style={styles.title}>CONTRAT DE LOCATION</Text>
        </View>

        <View style={{ textAlign: 'center', marginBottom: 15 }}>
          <Text style={styles.subtitle}>Maison « Ker Jean »</Text>
          <Text style={styles.address}>5 Place Saint-Ivy - PORTIVY, 56510 St Pierre Quiberon</Text>
        </View>

        <View style={styles.section}>
          <Text>Entre :</Text>
          <Text>Le propriétaire : <Text style={styles.bold}>Mr et Mme Milliot</Text> demeurant au 100 Bd Pereire, 75017 PARIS Paris</Text>
          <Text style={styles.bold}>(Tel 06.71.61.98.25, e-mail : helene.milliot@gmail.com)</Text>
        </View>

        <View style={styles.section}>
          <Text>et</Text>
          <Text>Le locataire : <Text style={styles.bold}>{data.locataireNom}</Text> demeurant au {data.locataireAdresse}</Text>
          <Text style={styles.bold}>Tel : {data.locataireTel} - e-mail : {data.locataireEmail}</Text>
        </View>

        <View style={{ marginTop: 10, marginBottom: 10 }}>
          <Text>Il a été exposé, convenu et arrêté ce qui suit :</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>Article 1 : Convention de location saisonnière</Text>
          <Text>Le propriétaire consent au locataire qui l'accepte, une location saisonnière en meublé de courte durée, portant sur les locaux désignés ci-après :</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.h2}>Article 2 : Désignation des locaux</Text>
          <Text>Résidence secondaire tout confort, simple.</Text>
          
          <View style={[styles.rowFlex, { marginTop: 4 }]}>
            <Text style={styles.label}>1er niveau :</Text>
            <View style={styles.value}>
              <Text>1 salon / salle à manger 35 m2</Text>
              <Text>1 chambre avec :</Text>
              <Text style={styles.bulletItem}>- 1 un lit double (160) + petite veranda</Text>
              <Text style={styles.bulletItem}>- 1 salle de douche et WC</Text>
              <Text>1 grande cuisine ouverte : (frigidaire-congélateur, cuisinière, machine à laver la vaisselle, four micro-ondes...)</Text>
              <Text>1 terrasse côté jardin avec meubles de jardin</Text>
            </View>
          </View>

          <View style={[styles.rowFlex, { marginTop: 8 }]}>
            <Text style={styles.label}>2eme niveau :</Text>
            <View style={styles.value}>
              <Text>2 chambres :</Text>
              <Text style={styles.bulletItem}>- 1 avec 2 lits simples (90)</Text>
              <Text style={styles.bulletItem}>- 1 avec 2 lits simples (90)</Text>
              <Text>1 pallier avec lit d'appoint (90)</Text>
              <Text>1 salle de bain avec baignoire</Text>
              <Text>1 wc indépendant</Text>
            </View>
          </View>

          <View style={[styles.rowFlex, { marginTop: 8 }]}>
            <Text style={styles.label}>Rez de jardin :</Text>
            <View style={styles.value}>
              <Text>La communication entre les 2 niveaux se fait par un escalier extérieur</Text>
              <Text>Pièce servant de rangement, « débarras ».</Text>
              <Text>1 wc indépendant</Text>
              <Text>Jardin (environ 500 m2)</Text>
            </View>
          </View>

          <Text style={{ marginTop: 8 }}>Parking public extérieur juste derrière la maison.</Text>
          <Text style={{ marginTop: 4 }}>Les draps, serviettes et torchons ne sont pas fournis.</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.h2}>Article 3 : Destination des lieux</Text>
          <Text>Le locataire utilise les locaux à titre de résidence temporaire de vacances à l’exclusion de toute utilisation commerciale ou professionnelle. Le locataire s’engage à ne pas ajouter à la destination prévue des activités différentes, sans que le propriétaire n’en soit averti et ne les accepte expressément, par acte écrit signé des 2 parties.</Text>
          <Text>Le locataire ne pourra céder sous quelque forme que ce soit tout ou partie de ses droits à la présente location. Toute sous-location, totale ou partielle, temporaire ou définitive est interdite sans l’accord du propriétaire.</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.h2}>Article 4 : Durée de la location</Text>
          <View style={[styles.rowFlex, { marginTop: 4 }]}>
            <Text style={{ width: 150 }}>Début de la location :</Text>
            <Text style={styles.bold}>{data.dateDebut}</Text>
          </View>
          <View style={[styles.rowFlex, { marginTop: 4 }]}>
            <Text style={{ width: 150 }}>Fin de la location :</Text>
            <Text style={styles.bold}>{data.dateFin}</Text>
          </View>
        </View>
        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.h2}>Article 5 : Loyer</Text>
          <Text>La location est consentie moyennant le paiement de la somme de : <Text style={styles.bold}>{data.loyerMontant} Euros</Text></Text>
          <Text style={{ marginTop: 8 }}>Le loyer comprend les charges locatives que sont les frais d’eau, de gaz. L'électricité sera à charge du locataire.</Text>
          <Text style={{ marginTop: 8 }}>Ce paiement sera acquitté en deux fois selon les modalités décrites ci-après :</Text>
          <Text style={{ marginTop: 8, marginLeft: 10 }}>
            - Le somme de <Text style={styles.bold}>{data.montantTotal} Euros (incluant le ménage)</Text> devra être réglé le <Text style={styles.bold}>{data.datePaiement}</Text> au plus tard. Le chèque est à établir à l'ordre de Mme Hélène Milliot et envoyé à l'adresse suivante : Hélène Milliot 100 Bd Pereire 75017 PARIS ou par virement (RIB ci-joint).
          </Text>
          <Text style={{ marginTop: 8, marginLeft: 10 }}>
            - L'électricité sera calculée en fonction de la consommation au prix de 16,60 cts Euros TTC/kWh par kWh consommé au delà d'une consommation de 30 Euros.
          </Text>
        </View>
        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.h2}>Article 6 : Dépôt de garantie</Text>
          <Text>Le locataire s'engage à déposer en garantie au propriétaire, la somme de <Text style={styles.bold}>{data.cautionMontant} euros</Text> par chèque bancaire (ou postal) établi à l'ordre du propriétaire, destinée à garantir la bonne exécution des clauses et conditions de la présente location. Ce chèque doit être envoyé par la poste en même temps que le solde de la location avant le <Text style={styles.bold}>{data.datePaiement}</Text> ou <Text style={styles.bold}>remis à la personne qui se chargera de l'accueil des locataires et la remise des clés.</Text> Ce règlement sera restitué au locataire en fin de location si aucune dégradation n'est constatée. A défaut, le solde de la caution sera envoyé au locataire une fois les dégradations réparées.</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.h2}>Article 7 : État des lieux et remise des clés</Text>
          <Text>Une visite des lieux est établie en présence du locataire et du propriétaire ou de son représentant, tant lors de la prise de possession des locaux par le preneur que lors du départ des lieux de celui-ci. Nous vous invitons particulièrement à signaler toute anomalie concernant la propreté des lieux.</Text>
          <Text>Le locataire devra rendre les clés des locaux loués le jour de l'expiration de la location ou le jour de son départ des lieux (dans le cas d'un départ antérieur à celui initialement prévu).</Text>
          <Text>Le locataire reste tenu des coûts inhérents aux réparations ou remplacement de toutes natures dont il est tenu de par la réglementation ou par le contrat de location y compris après la remise des clés et leur acceptation par le propriétaire</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.h2}>Article 8 : Entretien et jouissance des locaux :</Text>
          <Text>Le locataire s'engage à jouir et entretenir les locaux meubles et objets loués en bon père de famille. Il s'engage à ne rien faire qui puisse troubler la tranquillité, ni apporter un trouble de jouissance quelconque ou de nuisance au voisinage. Il se conformera aux prescriptions, règlements et ordonnances en vigueur, notamment en ce qui concerne l'hygiène, la sécurité, la voirie, la police, la salubrité et la tranquillité publiques.</Text>
          <Text>Le locataire s'engage à ne pas introduire dans les locaux loués des matières dangereuses et/ou inflammables y compris bouteilles de gaz.</Text>
          <Text>Le propriétaire s'engage à supporter les grosses réparations telles que celles-ci sont définies à l'article 606 du Code civil. En conséquence le locataire accepte de supporter et souffrir durant la location dans les lieux loués, de tous travaux qui se révèleraient nécessaires quelles qu'en soient l'importance et la durée à condition qu'ils ne remettent pas en cause le séjour du locataire.</Text>
          
          <Text style={[styles.bold, styles.underline, { marginTop: 8 }]}>Assurances :</Text>
          <Text style={styles.underline}>Nous vous invitons à vous assurer que votre assurance habitation comprend l’extension villégiature.</Text>
          
          <View style={[styles.rowFlex, { marginTop: 12 }]}>
            <Text style={{ width: 250, fontFamily: 'Helvetica-Bold' }}>Nombre de personnes (à remplir obligatoirement)</Text>
            <Text>{data.nbAdultes} adultes + {data.nbEnfants} enfants</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={[styles.section, { marginTop: 12 }]}>
          <Text style={styles.bold}>Ménage fin de séjour : Montant : {data.menageMontant} Euros</Text>
          <Text style={{ marginLeft: 20, marginTop: 4 }}>- Le paiement du ménage est à inclure dans le paiement du solde.</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.h2}>Article 9 : Annulation totale ou partielle</Text>
          <Text>En cas de séjour annulé ou abrégé, sauf solution de remplacement supprimant le préjudice du propriétaire, il ne sera procédé à aucun remboursement.</Text>
        </View>

        <View style={[styles.rowFlex, { marginTop: 15 }]}>
          <Text>Fait à : {data.lieuSignature}</Text>
          <Text style={{ marginLeft: 20 }}>Le {data.dateSignature}</Text>
        </View>

        <View style={styles.signatureContainer}>
          <Text>Les Propriétaires : Mr et Mme Milliot</Text>
          <Text>Le Locataire (lu et approuvé)</Text>
        </View>
      </Page>
    </Document>
  );
};

