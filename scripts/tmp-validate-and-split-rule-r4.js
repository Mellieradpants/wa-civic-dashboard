#!/usr/bin/env node
// Temporary diagnostic — not part of the pipeline, deleted after use.
// Validation run #4 for the "and"-split rule. Reuses round 3's logic with
// exactly three changes:
//   1. LOOK THROUGH AN INFINITIVE: when the second half's main verb is on
//      the no-actor list and is immediately followed by "to" + another verb
//      ("continue to make provisions"), evaluate that later verb instead.
//      If the later verb is a genuine action (not itself no-actor, and not
//      a bare "be" describing an ongoing state), allow the split. A bare
//      "be" as the later verb ("continue to be employed") still blocks --
//      "continuing to be in a state" is the same no-actor shape as
//      "remain"/"continue" themselves, not a new action, so it does not get
//      the top-level "be + participle is always passive" exception.
//   2. SHARED_ENDING: do not split when the first half ends on a bare "to"
//      (with or without a trailing comma) -- that shape means the words
//      after the second half's requirement word belong to BOTH halves
//      ("The department is not authorized to, and may not, supervise any
//      offender..." -- splitting strands "is not authorized to" unfinished).
//      The existing fail-safe does not catch this because the fragment is
//      not empty, only incomplete.
//   3. RETIRE AND_MAY_BE_PASSIVE: this control tag was defined in round 1
//      on the assumption that a passive second half was not a duty. Rounds
//      2-3 established the opposite -- a passive second half is performed
//      by someone even when nobody is named, and splitting it is correct.
//      Round 3 flagged 53 such splits as control-group false positives and
//      every one checked was a genuine split. The tag is removed entirely,
//      not just unreported. AS_MAY_BE and AND_WILL, evaluated at the
//      trigger, are unchanged.
// Trigger definition, "will" excluded as a trigger word, the chain fix
// (fail-safe tests from sentence start), multiple splits per sentence,
// actor inheritance, the no-actor verb list, and the fail-safe are
// otherwise unchanged from round 3. Raw output only -- no design, no
// fixes, no pipeline changes.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBillTextData } from "../api/wa-bill-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/wa");
const BIENNIUM = "2025-26";
const SAMPLE_SIZE = 200;
const OUTPUT_FILE = path.join(__dirname, "../tmp-validation-run4-results.txt");
const ROUND3_TOTAL_SPLITS = 216;
const ROUND3_TOTAL_BLOCKS = 4;

const BILL_INDEX = JSON.parse(readFileSync(path.join(DATA_DIR, "bill-index.json"), "utf8"));
const TEST_BILLS_CONFIG = JSON.parse(readFileSync(path.join(DATA_DIR, "test-bills.json"), "utf8"));
const excludedNumbers = new Set([...TEST_BILLS_CONFIG.sentinels, ...(TEST_BILLS_CONFIG.noDocumentBills || [])]);
const pool = [...new Set(
  BILL_INDEX.map(b => Number(b.bill_number))
    .filter(n => !excludedNumbers.has(n))
    .filter(n => !(n >= 4000 && n <= 4999))
    .filter(n => !(n >= 8000 && n <= 8999))
)].sort((a, b) => a - b);

const step = Math.max(1, Math.floor(pool.length / SAMPLE_SIZE));
const batch = [];
for (let i = 0; i < pool.length; i += step) batch.push(pool[i]);

function splitSentences(text) {
  return text
    .split(/(?<=[.!?;])\s+(?=[A-Z("])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

const singleLine = (s) => s.replace(/\s+/g, " ").trim();

// ─── Round 3 baseline: sentence (single-line) -> splitsPerformed ───────────
const ROUND3_BASELINE = JSON.parse(String.raw`{"A departure from the standards in RCW 9.94A.589 (1) and (2) governing whether sentences are to be served consecutively or concurrently is an exceptional sentence subject to the limitations in this section, and may be appealed by the offender or the state as set forth in RCW 9.94A.585 (2) through (6).": 1, "(b) The office of the superintendent of public instruction shall award grants under this section on a competitive basis and shall adopt rules for this purpose.": 1, "If the source of grant funding was general obligation bonds, then the repayment required for grant noncompliance under this subsection must be made to the state general fund and must include the principal amount of the grant plus interest calculated at the rate of interest on state of Washington general obligation bonds issued most closely to the date of authorization of the grant.": 1, "The committee must meet at least once a month and may hold additional meetings at the call of the chair or by a majority vote of the members of the committee.": 1, "RCW 59.18.365 and 2021 c 115 s 11 are each amended to read as follows: (1) The summons must contain the names of the parties to the proceeding, the attorney or attorneys if any, the court in which the same is brought, the nature of the action, in concise terms, and the relief sought, and also the return day; and must notify the defendant to appear and answer within the time designated or that the relief sought will be taken against him or her.": 1, "The order shall notify the defendant that if he or she fails to file a written answer, appear , and show cause at the time and place specified by the order the court may order the sheriff to restore possession of the property to the plaintiff and may grant such other relief as may be prayed for in the complaint and provided by this chapter.": 1, "In its order setting trial, the court shall identify with specificity each issue requiring trial and shall grant appropriate relief to the appropriate party on all other issues.": 1, "The tax is in addition to other taxes authorized by law and must be collected from those persons who are taxable by the state under chapters 82.08 and 82.12 RCW upon the occurrence of any taxable event within the city or county.": 1, "This subsection does not apply to higher education undergraduate and graduate student employees and shall be administered consistent with the requirements of the federal internal revenue code.": 1, "Recommendations required by this subsection (3)(a) should address governance, operations, and codification, and must be in the form of draft legislation.": 1, "(2) Except as provided in subsection (3) of this section, fees charged shall be based on, but shall not exceed, the cost to the department for the licensure of the activity or class of activities and may include costs of necessary inspection.": 1, "The legislature further finds that partnerships with nongovernmental organizations support emergency planning and preparedness and may be used to support identification and operation of coshelters.": 1, "RCW 29A.08.510 and 2009 c 369 s 26 are each amended to read as follows: The registrations of deceased voters may be canceled from voter registration lists as follows: (1) Periodically, the registrar of vital statistics of the state shall prepare a list of persons who resided in each county, for whom a death certificate was transmitted to the registrar and was not included on a previous list, and shall supply the list to the secretary of state.": 1, "(c) If the challenge is to the residential address provided by the voter, the challenged voter must be provided notice of the exceptions allowed in RCW 29A.08.112 and 29A.04.151 , and Article VI, section 4 of the state Constitution, and may update the residence address on the voter's voter registration, or reregister until 8:00 p.m. the day of the election.": 1, "(b) If a voter is successfully challenged under RCW 29A.08.810 (1)(c), the county auditor shall send a notice to the voter and shall not remove the voter from the official state voter registration list unless the voter fails to respond to the notice and fails to vote or confirm their voter registration address during the time period that includes the next two general elections.": 1, "(d) One member must be either a licensed advanced social worker or a licensed independent clinical social worker; and (e) Three members must be consumers and represent the public at large and may not be licensed mental health care providers.": 1, "(b) Each member must not hold a governing office or board position in a professional association for mental health, social work, or marriage and family therapy and must not be employed by the state of Washington.": 1, "Funding for programs operated by local school districts shall be on an excess cost basis from appropriations provided by the legislature for special education programs for students with disabilities and shall take account of state funds accruing through RCW 28A.150.260 (4)(a), (5), (6), and (8) and 28A.150.415 .": 1, "The board shall adopt a seal and may adopt such bylaws, rules, and regulations as it deems necessary for its own government.": 1, "A majority of members of the board shall constitute a quorum, but a lesser number may adjourn from time to time and may compel the attendance of absent members in such manner as prescribed in its bylaws, rules, or regulations.": 1, "RCW 28A.225.220 and 2013 2nd sp.s. c 18 s 510 are each amended to read as follows: (1) Any board of directors may make agreements with adults choosing to attend school, and may charge the adults reasonable tuition.": 1, "(c) It is a class C felony if a person is a leader or organizer of the people engaging in obstructing highways and must pay a monetary penalty of at least $5,000, which may not be reduced to an amount less than $1,000.": 1, "(b) Owners who do not seek voluntary compliance and are found to have constructed or placed a detached accessory dwelling unit without all required permits must be subject to a civil infraction of at least $1,000 and must be required to remove the detached accessory dwelling unit or ensure that it meets all existing development regulations, if applicable.": 1, "(3) When an arrest is made for a violation of RCW 46.20.342 , if the vehicle is a commercial vehicle or farm transport vehicle and the driver of the vehicle is not the owner of the vehicle, before the summary impoundment directed under subsection (1) of this section, the police officer shall attempt in a reasonable and timely manner to contact the owner of the vehicle and may release the vehicle to the owner if the owner is reasonably available, as long as the owner was not in the vehicle at the time of the stop and arrest and the owner has not received a prior release under this subsection or RCW 46.55.120 (1)(b)(ii).": 1, "A court authorizing such a release shall issue an order containing a statement of conditions imposed upon the juvenile and shall set the date of his or her next court appearance.": 1, "The court shall advise the juvenile of any conditions specified in the order and may at any time amend such an order in order to impose additional or different conditions of release upon the juvenile or to return the juvenile to custody for failing to conform to the conditions imposed.": 1, "(6) The department is not authorized to, and may not, supervise any offender sentenced to a term of community custody or any probationer unless the offender or probationer is one for whom supervision is required under this section or RCW 9.94A.5011 .": 1, "(b) The secretary shall, for the period of parole, facilitate the juvenile's reintegration into his or her community and to further this goal shall require the juvenile to refrain from possessing a firearm or using a deadly weapon, and refrain from committing new offenses or violating any orders issued by the juvenile court pursuant to chapter 7.105 RCW, and may require the juvenile to: (i) Undergo available medical, psychiatric, drug and alcohol, sex offender, mental health, and other offense-related treatment services;": 1, "Offenders participating in an intensive supervision program shall be required to comply with all terms and conditions listed in (b) of this subsection and shall also be required to comply with the following additional terms and conditions: (i) Obey all laws and refrain from any conduct that threatens public safety;": 1, "The event, \"chief for a day,\" occurs on one day, annually or every other year and may occur on the grounds and in the facilities of the commission.": 0, "Employing agencies may only make a conditional offer of employment pending completion of the background check and shall verify in writing to the commission that they have complied with all background check requirements prior to making any nonconditional offer of employment.": 1, "For personnel initially employed before January 1, 1990, such training shall be successfully completed during the first 15 months of employment of such personnel unless otherwise extended or waived by the commission and shall be requisite to the continuation of such employment.": 1, "(3) Except as provided in RCW 43.101.170 , the commission shall provide the aforementioned training and shall have the sole authority to do so.": 1, "(2) In all hearings requested under RCW 43.101.155 , an administrative law judge appointed under chapter 34.12 RCW shall be the presiding officer and shall make all necessary rulings in the course of the hearing, but is not entitled to vote.": 1, "RCW 81.60.010 and 2001 c 72 s 1 are each amended to read as follows: The criminal justice training commission shall have the power to and may in its discretion commission railroad police officers at the request of any railroad corporation and may revoke any commission at its pleasure.": 2, "The application shall be signed by the president or some managing officer of the railroad corporation and shall be accompanied by an affidavit stating that the officer is acquainted with the person whose commission is sought, that the officer believes the person to be of good moral character, and that the person is of such character and experience that he or she can be safely entrusted with the powers of a police officer.": 1, "RCW 81.60.030 and 2001 c 72 s 3 are each amended to read as follows: Before receiving a commission each person shall successfully complete a course of training prescribed or approved by the criminal justice training commission, and shall take, subscribe, and file with the commission an oath to support the Constitution of the United States and the Constitution and laws of the state of Washington, and to faithfully perform the duties of the office.": 1, "RCW 81.60.060 and 2001 c 72 s 6 are each amended to read as follows: The corporation procuring a commission of any railroad police shall be solely responsible for the compensation for the officer's services and shall be liable civilly for any unlawful act of the officer resulting in damage to any person or corporation.": 1, "(1) The executive director must employ staff who shall be state employees under Title 41 RCW and must prescribe staff duties as necessary to implement this chapter.": 1, "(2) Any city or county may authorize the use of automated traffic safety cameras and must adopt an ordinance authorizing such use through its local legislative authority.": 1, "Beginning January 1, 2026, the annual report must include the percentage of revenues received from fines issued from automated traffic safety camera infractions that were used to pay for the costs of the automated traffic safety camera program and must describe the uses of revenues that exceeded the costs of operation and administration of the automated traffic safety camera program by the city or county.": 1, "(11) Notwithstanding any other provision of law, all photographs, microphotographs, electronic images, or audio recordings, or any other personally identifying data prepared under this section are for the exclusive use of authorized city or county employees, as specified in RCW 46.63.030 (1)(d), in the discharge of duties under this section and are not open to the public and may not be used in a court in a pending action or proceeding unless the action or proceeding relates to a violation under this section.": 1, "(12) If a county or city has established an automated traffic safety camera program as authorized under this section, the compensation paid to the manufacturer or vendor of the equipment used must be based only upon the value of the equipment and services provided or rendered in support of the system and may not be based upon a portion of the fine or civil penalty imposed or the revenue generated by the equipment.": 1, "(3) If any motor vehicle without a driver is found parked, standing, or stopped in violation of this title or an equivalent administrative regulation or local law, ordinance, regulation, or resolution, the officer finding the vehicle shall take its registration number and may take any other information displayed on the vehicle which may identify its user, and shall conspicuously affix to the vehicle a notice of traffic infraction.": 2, "These conditions shall be individualized to address the person's specific risk factors and criminogenic needs and may include, but are not limited to , the following: Specification of residence or restrictions on residence including distance restrictions, specification of contact with a reasonable number of individuals upon the person's request who are verified by the department of corrections to be appropriate social contacts, prohibition of contact with potential or past victims, prohibition of alcohol and other drug use, participation in a specific course of inpatient or outpatient treatment that may include monitoring by the use of polygraph and plethysmograph, monitoring through the use of global positioning system technology, supervision by a department of corrections community corrections officer, a requirement that the person remain within the state unless the person receives prior authorization by the court, and any other conditions that the court determines are in the best interest of the person or others.": 1, "(4) The commission shall determine if an investor-owned utility may recover the cost of this administrative penalty in electric rates, and may consider providing positive incentives for an investor-owned utility to exceed the targets established in RCW 19.285.040 .": 1, "RCW 43.79A.040 and 2024 c 327 s 16 and 2024 c 168 s 10 are each reenacted and amended to read as follows: (1) Money in the treasurer's trust fund may be deposited, invested, and reinvested by the state treasurer in accordance with RCW 43.84.080 in the same manner and to the same extent as if the money were in the state treasury, and may be commingled with moneys in the state treasury for cash management and cash balance purposes.": 1, "RCW 43.79A.040 and 2024 c 327 s 17 and 2024 c 168 s 11 are each reenacted and amended to read as follows: (1) Money in the treasurer's trust fund may be deposited, invested, and reinvested by the state treasurer in accordance with RCW 43.84.080 in the same manner and to the same extent as if the money were in the state treasury, and may be commingled with moneys in the state treasury for cash management and cash balance purposes.": 1, "Refunds of interest to the federal treasury required under the cash management improvement act fall under RCW 43.88.180 and shall not require appropriation.": 1, "(3) State grant funds under this section may be used to support the education of American Indian and Alaska Native students and may enhance activities under federal grants.": 1, "(5) After 30 days following removal from the directory, the vapor products containing nicotine of a manufacturer identified in the notice of removal and intended for retail sale in this state or to a consumer in this state are subject to seizure, in accordance with RCW 82.25.095 , from distributors and retailers, forfeiture from distributors and retailers, and destruction or disposal, and may not be purchased or sold for retail sale in this state or to a consumer in this state.": 1, "(4) After 60 days following publication of the directory, vapor products containing nicotine not listed in the directory and intended for retail sale in this state or to a consumer in this state are subject to seizure, forfeiture, and destruction or disposal, and may not be purchased or sold for retail sale in this state or to a consumer in this state except as provided in subsections (2) and (3) of this section.": 1, "(4) Vapor products containing nicotine offered for sale in violation of sections 7 through 17 of this act are considered contraband and may be seized and disposed of or destroyed by an enforcement officer of the board.": 1, "(2) The manufacturer must provide notice to the board 30 days before termination of the authority of an agent and must further provide proof to the satisfaction of the board of the appointment of a new agent no fewer than five days before the termination of an existing agent appointment.": 1, "(3) Any manufacturer whose vapor products containing nicotine are sold in this state, who has not appointed and engaged an agent as required in this section, must be deemed to have appointed the secretary of state as the agent and may be proceeded against in courts of this state by service of process upon the secretary of state.": 1, "All data must be reported in the aggregate form and shall be posted on the department's website and submitted to the governor and the relevant committees of the legislature.": 1, "Data elements related to the identification of individual patients', providers', and facilities' care outcomes shall be confidential, are not subject to disclosure under the public records act, chapter 42.56 RCW, and shall not be subject to discovery by subpoena or admissible as evidence.": 1, "RCW 28A.160.170 and 2021 c 234 s 3 are each amended to read as follows: Each district shall submit three times each year to the superintendent of public instruction during October, February, and May of each year a report containing the following: (1)(a) The number of eligible students transported to and from school as provided for in RCW 28A.160.150 , along with identification of stop locations and school locations ;": 1, "(2) Funds allocated to school districts under this section must be equal to $400 for each student that requires special transportation due to the requirements of the McKinney Vento homeless assistance act, as reported under RCW 28A.160.170 , and may only be used to address transportation costs associated with such students. --- END ---": 1, "Tips and service charges paid to an employee are in addition to, and may not count towards, the employee's hourly minimum wage.": 1, "The directors shall be elected by the members of the association at such time, in such manner, and for such term of office as the bylaws may prescribe, and shall hold office during the term for which they were elected and until their successors are elected and qualified.": 1, "RCW 24.06.130 and 2011 c 336 s 665 are each amended to read as follows: (1) The number of directors of a corporation shall be not less than three and shall be fixed by the bylaws: PROVIDED, That the number of the first board of directors shall be fixed by the articles of incorporation.": 1, "(2) The directors constituting the first board of directors shall be named in the articles of incorporation and shall hold office until the first annual election of directors or for such other period as may be specified in the articles of incorporation or the bylaws.": 1, "(b) Unless the offender waives the right to a hearing, the department shall hold a hearing, and shall record it electronically.": 1, "Prior convictions that were not counted in the offender score or included in criminal history under repealed or previous versions of the sentencing reform act shall be included in criminal history and shall count in the offender score if the current version of the sentencing reform act requires including or counting those convictions.": 1, "(f) Nonemitting electric generation used to meet the standard under (a) of this subsection must be generated during the compliance period and must be verified by documentation that the electric utility owns the nonpower attributes of the electricity generated by the nonemitting electric generation resource.": 1, "(3) Energy transformation projects or advanced nuclear reactor projects must be associated with the consumption of energy in Washington and must not create a new use of fossil fuels that results in a net increase of fossil fuel usage.": 1, "(1) A small business entity may join or form a joint self-insurance program together with one or more other small business entities, and may jointly purchase insurance or reinsurance with one or more other small business entities for property and liability risks only as permitted under this chapter.": 1, "(2) All interest and earnings collected on program funds belong to the program and must be deposited to the program's credit in the proper program account.": 1, "This threshold screening analysis may rely on screening and map tools adopted by the department, the department of health, or recommended by the environmental justice council established in chapter 70A.02 RCW, and must include consideration of cumulative impacts in such overburdened communities and vulnerable populations in conjunction with other social determinants of health.": 1, "(2) Local authorities in their respective jurisdictions shall determine by an engineering and traffic investigation the proper maximum speed for all arterial streets and shall declare a reasonable and safe maximum limit thereon , which may be greater or less than the maximum speed permitted under RCW 46.61.400 (2) but shall not exceed 60 miles per hour.": 1, "RCW 46.61.110 and 2023 c 471 s 4 are each amended to read as follows: The following rules shall govern the overtaking and passing of vehicles proceeding in the same direction: (1)(a) The driver of a vehicle overtaking other traffic proceeding in the same direction shall pass to the left of it at a safe distance and shall not again drive to the right side of the roadway until safely clear of the overtaken traffic.": 1, "(3) Except when overtaking and passing on the right is permitted, overtaken traffic shall give way to the right in favor of an overtaking vehicle on audible signal and shall not increase speed until completely passed by the overtaking vehicle.": 1, "(2) Before issuing nonvoted bonds in excess of $250,000 , a school district shall publish notice of intent to issue such bonds and shall hold a public hearing on the proposal at any regular or special meeting of the school board.": 1, "It must provide for administrative approval of a binding site plan, and must provide processes for altering and vacating a binding site plan.": 1, "(6) It is a violation of this chapter, and may be restrained by injunctive action and found illegal as provided in this chapter, to sell, transfer, or lease any lot or tract that is on a binding site plan that has not been approved and recorded or does not conform to the requirements of the binding site plan.": 1, "RCW 58.17.065 and 1974 ex.s. c 134 s 12 are each amended to read as follows: Each short plat and short subdivision granted by a city, town, or county pursuant to local regulations after July 1, 1974, and for which a complete application was submitted for approval on or before June 30, 2026, shall be recorded with the county auditor of the county or counties in which the land is located and shall not be deemed \"approved\" unless the documents are recorded .": 1, "The final plat must be processed administratively pursuant to RCW 58.17.140 (4) and may not be required to provide notice pursuant to RCW 36.70B.110 and may not require a public hearing.": 2, "RCW 58.17.120 and 1974 ex.s. c 134 s 6 are each amended to read as follows: The official with authority to approve plats shall consider the physical characteristics of a proposed subdivision and may disapprove or condition approval of a proposed plat based on adopted development regulations and codes addressing flood, inundation, or swamp conditions.": 1, "The application shall set forth the reasons for vacation and shall contain signatures of all parties having an ownership interest in that portion of the subdivision subject to vacation.": 1, "The city, town, or county shall give notice as provided in RCW 58.17.080 and shall conduct a public hearing on the application for a vacation if required by local ordinance and may approve or deny the application for vacation of the subdivision based on determining whether the public use and interest would be served by the vacation of the subdivision.": 2, "RCW 48.62.031 and 2019 c 26 s 3 are each amended to read as follows: (1) The governing body of a local government entity may individually self-insure, may join or form a self-insurance program together with other entities, including the board of pilotage commissioners, and may jointly purchase insurance or reinsurance with those other entities for property and liability risks, and health and welfare benefits only as permitted under this chapter.": 1, "(2) The agreement to form a joint self-insurance program shall be made under chapter 39.34 RCW and may create a separate legal or administrative entity with powers delegated thereto.": 1, "(c) The appointment of the risk manager as attorney shall be irrevocable, shall bind any successor in interest or to the assets or liabilities of the joint self-insurance program, and shall remain in effect as long as there is in force in this state any contract made by the joint self-insurance program or liabilities or duties arising therefrom.": 0, "(2) All public school outdoor recreational spaces shall be designated as green community schoolyards and shall be available for general recreational purposes outside of school hours for public and community use, as authorized by school districts.": 1, "(a) The remaining board members must be persons who are not elected officials and must be selected from the following categories consistent with the requirements of this section and the rules adopted by the state board of health under RCW 43.20.300 : (i) Public health, health care facilities, and providers.": 1, "These individuals may not be elected officials and may not have any fiduciary obligation to a health facility or other health agency, and may not have a material financial interest in the rendering of health services; and (iii) Other community stakeholders.": 2, "(e) If a federally recognized Indian tribe holds reservation, trust lands, or has usual and accustomed areas within the county, or if a 501(c)(3) organization registered in Washington that serves American Indian and Alaska Native people and provides services within the county, the board of health must include a tribal representative from each tribe and each organization and must notify the American Indian health commission.": 1, "RCW 70.05.035 and 2021 c 205 s 4 are each amended to read as follows: (1) Except as provided in subsection (2) of this section, for home rule charter counties, the county legislative authority shall establish a local board of health and may prescribe the membership and selection process for the board.": 1, "The district board of health of such a district shall consist of not less than five members for districts of two counties and seven members for districts of more than two counties, including two representatives from each county who are members of the board of county commissioners and who are appointed by the board of county commissioners of each county within the district, and members selected under (a) and (e) of this subsection, and shall have a jurisdiction coextensive with the combined boundaries.": 1, "These individuals may not be elected officials, and may not have any fiduciary obligation to a health facility or other health agency, and may not have a material financial interest in the rendering of health services; and (iii) Other community stakeholders.": 2, "(e) If a federally recognized Indian tribe holds reservation, trust lands, or has usual and accustomed areas within the health district, or if a 501(c)(3) organization registered in Washington that serves American Indian and Alaska Native people and provides services within the health district, the board of health must include a tribal representative from each tribe and each organization and must notify the American Indian health commission.": 1, "(4)(a) Every contract between a health care service contractor and a participating provider of health care services shall be in writing and shall state that in the event the health care service contractor fails to pay for health care services as provided in the contract, the enrolled participant shall not be liable to the provider for sums owed by the health care service contractor.": 1, "(2) The tax rate is three percent of the selling price of the renewable energy facility and must be assessed on the seller.": 1, "RCW 46.61.140 and 2020 c 199 s 2 are each amended to read as follows: Whenever any roadway has been divided into two or more clearly marked lanes for traffic the following rules in addition to all others consistent herewith shall apply: (1) A vehicle shall be driven as nearly as practicable entirely within a single lane and shall not be moved from such lane until the driver has first ascertained that such movement can be made with safety.": 1, "(10) \"Crime-related prohibition\" means an order of a court prohibiting conduct that directly relates to the circumstances of the crime for which the offender has been convicted, and shall not be construed to mean orders directing an offender affirmatively to participate in rehabilitative programs or to otherwise perform affirmative conduct.": 1, "(2) The secretary of the department may transfer an incarcerated individual from a department correctional facility to home detention in the community if it is determined that the graduated reentry program is an appropriate placement and must assist the incarcerated individual's transition from confinement to the community.": 1, "(a) The board may cause an inspection of the premises to be made, and may inquire into all matters in connection with the construction and operation of the premises.": 1, "Requests under this subsection (2)(d)(i) must be in writing and may be made electronically.": 1, "(1) This chapter does not apply to a bona fide news or public interest broadcast, website video, report, or event and may not be construed to affect the rights of a news-gathering organization.": 1, "If practicable, standards adopted by the local legislative authorities shall comply with Washington state court rules for public defense services and may incorporate provisions of standards endorsed by the Washington state bar association that do not conflict with court rules . --- END ---": 1, "(g) Any claim resolution settlement agreement entered into under this section must be in writing and signed by the parties or their representatives and must clearly state that the parties understand and agree to the terms of the agreement.": 1, "If the department determines that an employer has engaged in a pattern of harassment or coercion, the employer may be subject to penalty or corrective action, and may be removed from the retrospective rating program or be decertified from self-insurance under RCW 51.14.030 .": 1, "(d) A retail establishment that uses a third-party platform must list on that third-party platform the applicable pass-through charges associated with each customer order, and must collect the pass-through charge from the customer through the third-party platform for carryout bags provided to the customer that are subject to the pass-through charge.": 1, "(12) \"Fixed or established place of business\" for the purpose of this chapter means any permanent warehouse, building, or structure, at which necessary and appropriate equipment and fixtures are maintained for properly handling those agricultural products generally dealt in, and at which supplies of the agricultural products being usually transported are stored, offered for sale, sold, delivered, and generally dealt with in quantities reasonably adequate for and usually carried for the requirements of such a business, and that is recognized as a permanent business at such place, and carried on as such in good faith and not for the purpose of evading this chapter, and where specifically designated personnel are available to handle transactions concerning those agricultural products generally dealt in, which personnel are available during designated and appropriate hours to that business, and shall not mean a residence, barn, garage, tent, temporary stand or other temporary quarters, any railway car, or permanent quarters occupied pursuant to any temporary arrangement.": 1, "(2) The value of the ratio obtained is the annual adjustment to the original retirement allowance and must be applied beginning with the July payment.": 1, "(9) The contributions received for the higher education retirement plan supplemental benefit fund shall be deposited in the higher education retirement plan supplemental benefit fund and amounts received from each institution accounted for separately and shall only be used to make benefit payments to the beneficiaries of that institution's plan.": 1, "(2) Not later than July 31, 2008, and every two years thereafter, consistent with the economic assumptions and asset value smoothing technique included in RCW 41.45.035 or adopted under RCW 41.45.030 or 41.45.035 , the council shall adopt and may make changes to: (a) Basic employer contribution rates for the public employees' retirement system, the teachers' retirement system, the school employees' retirement system, the public safety employees' retirement system, and the Washington state patrol retirement system; and (b) Basic employer contribution rates for the legacy retirement system .": 1, "Except as provided in subsections (6), (7), and (9) of this section, the supplemental contribution rates required by this section shall be calculated by the state actuary and shall be charged regardless of language to the contrary contained in the statute which authorizes additional benefits.": 1, "(b) Once an eligible person elects to participate in the salary reduction plan and determines the amount his or her gross salary shall be reduced and the benefit plan for which the funds are to be used during the plan year, the agreement shall be irrevocable and may not be amended during the plan year except as provided in (c) of this subsection.": 1, "(3) Every municipality shall make provisions for the collection and payment of the fees required under this chapter, and shall continue to make provisions for all reserve officers who come under this chapter as long as they continue to be employed as reserve officers.": 0, "RCW 41.50.080 and 2011 1st sp.s. c 47 s 21 are each amended to read as follows: The state investment board shall provide for the investment of all funds of the Washington public employees' retirement system, the teachers' retirement system, the school employees' retirement system, the Washington law enforcement officers' and firefighters' retirement system, the Washington state patrol retirement system, the Washington judicial retirement system, the Washington public safety employees' retirement system, the legacy retirement system, the higher education retirement plan supplemental benefit fund, and the judges' retirement fund, pursuant to RCW 43.84.150 , and may sell or exchange investments acquired in the exercise of that authority.": 1, "The directive may be in the following form and may include a notarial certificate for an acknowledgment in an individual capacity in short form as permitted by state law, but in addition may include other specific directions: Health Care Directive Directive made this . . . . day of . . . . . .": 1, "RCW 48.62.031 and 2019 c 26 s 3 are each amended to read as follows: (1) The governing body of a local government entity may individually self-insure, may join or form a self-insurance program together with other entities, including the board of pilotage commissioners, and may jointly purchase insurance or reinsurance with those other entities for property and liability risks, underinsured coverage under section 1 of this act, and health and welfare benefits only as permitted under this chapter.": 1, "Such license shall permit the resident physician to practice medicine only in connection with his or her duties as a resident physician and shall not authorize the physician to engage in any other form of practice.": 1, "Such license shall permit the recipient to practice medicine only within the confines of the instructional program specified in the application and shall terminate whenever the holder ceases to be involved in that program, or at the end of one year, whichever is earlier.": 1, "(f) A limited license issued under this subsection is valid for two years and may be renewed three times by the commission upon application for renewal by the nominating entity for a total of eight years .": 1, "(c) The notice referred to in (a)(i) and (ii) of this subsection must be in writing and must state: \"The unit you will be occupying is, or may become, part of a common interest community and subject to sale.\" (14) \"Convey\" or \"conveyance\" means, with respect to a unit, any transfer of ownership of the unit, including a transfer by deed or by real estate contract and, with respect to a unit in a leasehold common interest community or a proprietary lease in a cooperative, a transfer by lease or assignment of the unit, but does not include the creation, transfer, or release of a security interest.": 1, "(c) Unless provided otherwise in the declaration or organizational documents, board members and officers must take office upon adjournment of the meeting at which they were elected or appointed or, if not elected or appointed at a meeting, at the time of such election or appointment, and must serve until their successor takes office.": 1, "The notice must be given at least 14 days before the meeting and must state the time, date, place, and agenda of the meeting.": 1, "(b) The approval or denial of an application must be in writing and must not be willfully avoided or delayed.": 1, "(10)(a) A unit owners association that willfully violates this section is liable to the unit owner for actual damages, and shall pay a civil penalty to the unit owner in an amount not to exceed $1,000.": 1, "The board may provide that the special assessment may be due and payable in installments over any period it determines and may provide a discount for early payment.": 1, "(8)(a) A unit owners association that willfully violates this section is liable to the unit owner for actual damages, and shall pay a civil penalty to the unit owner in an amount not to exceed $1,000.": 1, "It may not include all reserve components that will require major maintenance, repair, or replacement in future years, and may not include regular contributions to a reserve account for the cost of such maintenance, repair, or replacement.": 1, "Any other payments you make to the seller of a unit are at risk and may be lost if the seller defaults.\" (g) \"CONSTRUCTION DEFECT CLAIMS.": 1, "THE GOVERNING DOCUMENTS MAY PROHIBIT OWNERS FROM MAKING CHANGES TO THE UNIT WITHOUT REVIEW AND THE APPROVAL OF THE ASSOCIATION, AND MAY ALSO IMPOSE RESTRICTIONS ON THE USE OF THE UNIT, DISPLAY OF SIGNS, CERTAIN BEHAVIORS, AND OTHER ITEMS.": 1, "(b) A background check for an original permit must be conducted through the Washington state patrol criminal records division and shall include a national check from the federal bureau of investigation through the submission of fingerprints.": 1, "(10) The permit to purchase firearms must be in a form prescribed by the Washington state patrol firearms background check program and must contain a unique permit number, expiration date, and the name, date of birth, residential address, and brief description of the licensee.": 1, "(d) A background check for an original license must be conducted through the Washington state patrol criminal identification section and shall include a national check from the federal bureau of investigation through the submission of fingerprints.": 1, "The license shall contain a description of the major differences between state and federal law and an explanation of the fact that local laws and ordinances on firearms are preempted by state law and must be consistent with state law.": 1, "A licensee renewing after the expiration date of the license under this subsection shall pay only the renewal fee specified in subsection (6) of this section and shall not be required to pay a late renewal penalty in addition to the renewal fee.": 1, "(13) (a) By October 1, 2019, law enforcement agencies that issue concealed pistol licenses shall develop and implement a procedure for the renewal of concealed pistol licenses through a mail application process, and may develop an online renewal application process, for any person who, as a member of the armed forces, including the national guard and armed forces reserves, is unable to renew his or her license under subsection (7) of this section because of the person's assignment, reassignment, or deployment for out-of-state military service.": 1, "An employee must be at least 21 years of age, eligible to possess a firearm, and must not have been convicted of a crime that would make the person ineligible for a concealed pistol license, before being permitted to sell a firearm.": 1, "(iv) The system shall be capable of recording 24 hours per day at a frame rate no less than 15 frames per second, and must either (A) record continuously or (B) be activated by motion and remain active for at least 15 seconds after motion ceases to be detected;": 1, "(13) A dealer shall: (a) Establish and maintain a book, or if the dealer should choose, an electronic-based record of purchase, sale, inventory, and other records at the dealer's place of business and shall make all such records available to law enforcement upon request.": 1, "(4) If a law enforcement agency receives a protection order for entry or service, but the order falls outside the agency's jurisdiction, the agency may enter and serve the order or may immediately forward it to the appropriate law enforcement agency for entry and service, and shall provide documentation back to the court verifying which law enforcement agency has entered and will serve the order.": 1, "Subarea plans adopted under this subsection (2)(a)(i) must clarify, supplement, or implement jurisdiction-wide comprehensive plan policies, and may only be adopted if the cumulative impacts of the proposed plan are addressed by appropriate environmental review under chapter 43.21C RCW;": 1, "Counties and cities may begin this process early and may be eligible for grants from the department, subject to available funding, if they elect to do so.": 1, "RCW 46.20.328 and 1979 c 61 s 11 are each amended to read as follows: Upon the conclusion of a driver improvement interview, the department's referee shall make findings on the matter under consideration and shall notify the person involved in writing .": 1, "RCW 46.20.329 and 1982 c 189 s 4 are each amended to read as follows: Upon receiving a request for a formal hearing as provided in RCW 46.20.328 , the department shall fix a time and place for hearing , including a remote hearing, as early as may be arranged , and shall give 10 days' notice of the hearing to the applicant or licensee.": 1, "Any decision by the department suspending or revoking a person's driving privilege shall be stayed and shall not take effect while a formal hearing is pending as herein provided or during the pendency of a subsequent appeal to superior court: PROVIDED, That this stay shall be effective only so long as there is no conviction of a moving violation or a finding that the person has committed a traffic infraction that is a moving violation during pendency of hearing and appeal: PROVIDED FURTHER, That nothing in this section shall be construed as prohibiting the department from seeking an order setting aside the stay during the pendency of such appeal in those cases where the action of the department is based upon physical or mental incapacity, or a failure to successfully complete an examination required by this chapter.": 1, "(2) Upon receipt of a request for a hearing, the department shall schedule a hearing , including a remote hearing, and shall give at least 10 days' notice of the hearing to the person.": 1, "(44) \"Professional person\" means a mental health professional, substance use disorder professional, or designated crisis responder and shall also mean a physician, physician assistant, psychiatric advanced registered nurse practitioner, registered nurse, and such others as may be defined by rules adopted by the secretary pursuant to the provisions of this chapter;": 1, "RCW 48.37.050 and 2007 c 82 s 7 are each amended to read as follows: (1) Market conduct actions shall be taken as a result of market analysis and shall focus on the general business practices and compliance activities of insurers, rather than identifying obviously infrequent or unintentional random errors that do not cause significant consumer harm.": 1, "(4) Appoints the insurance commissioner as its true and lawful attorney upon whom may be served lawful process in any action, suit, or proceeding in any court, which appointment is irrevocable, binds the insurer or institution or any successor in interest, remains in effect as long as there is in force in this state any contract made or issued by the insurer or institution, or any obligation arising therefrom, and must be processed in accordance with RCW 48.05.200 ;": 1, "The notice must be in writing and must be transmitted at the earliest of the next mailing to the policyholder, the yearly summary of benefits sent to the policyholder, or January 1 of the year following June 6, 1996.": 1, "(b) For health plans issued or renewed on or after January 1, 2026, a health carrier shall provide coverage for hearing instruments as provided in subsection (1) of this section every 36 months per ear with hearing loss and may not establish any lifetime or annual limit on the dollar amount of coverage for services described in subsection (1) or (2) of this section for any individual, whether provided in-network or out-of-network.": 1, "(1) The legislature finds that, as of 2025: (a) Washington's statewide waste recovery rate has been generally static since 2011 and Washington is not meeting the statewide goal of 50 percent recycling established in 1989; and (b) Many residents, particularly those who live in rural areas and in multifamily residences, do not have access to convenient or affordable curbside recycling, and must rely on taking recyclables to drop box locations, and that extended producer responsibility programs could make curbside recycling available and affordable for most people in the state.": 1, "(c) In administering the reuse financial assistance program, the producer responsibility organization must solicit applications using an open and competitive process and must select applications through an evaluation that considers criteria including, but not limited to: (i) The environmental benefits of the activity;": 1, "(7)(a) The advisory council must meet at least two times per year and may meet more frequently upon 10 days' written notice at the request of the chair or a majority of its members.": 1, "(9) The department shall provide administrative and operating support to the advisory council, including compensation in accordance with subsection (5) of this section, and may contract with a third-party facilitator to assist in administering the activities of the advisory council, including establishing a website or landing page on the department website.": 1, "(1) The department must implement, administer, and enforce this chapter and may adopt rules as necessary for those purposes.": 1, "(2)(a) Material recovery facilities receiving covered materials collected from covered entities must register as service providers as described in subsection (1) of this section and must additionally report annually to the department by commodity type and covered material type, in a form and format created by the department, on the following: (i) Tons received and processed, by jurisdiction and service provider;": 1, "(c) The contractor conducting the needs assessment must aggregate and anonymize the nonpublic data or information, excluding location data as necessary to assess needs, received from all parties under this section and must then include the aggregated anonymized data in the needs assessment.": 1, "(2) A producer responsibility organization must submit a draft plan or draft amendment to the advisory council at least 60 days prior to submitting to the department to allow the advisory council to submit comments and must address advisory council comments and recommendations prior to the submission of the draft plan or draft plan amendment to the department.": 1, "(4) For purposes of determining whether recycling performance targets are being met, except as modified by the department, a plan must provide a methodology for measuring the amount of covered material sent for recycling at the point at which material leaves a material recovery facility or other processing facility and must account for: (a) Levels and types of estimated contamination documented by the facility;": 1, "(1) By September 1, 2038, the department must contract with an independent consultant to analyze the impacts of the initial seven years of program implementation and must submit a report summarizing the analysis to the appropriate committees of the legislature.": 1, "The authority may ascertain the facts regarding all such applications in such reasonable manner and under such rules as it may deem proper and shall remit or mitigate the penalty only upon a demonstration of extraordinary circumstances such as the presence of information or factors not considered in setting the original penalty.": 1, "(f) If the court does make a finding under (c) of this subsection that commitment to an institution is needed, the court must maintain concurrent jurisdiction over the juvenile, along with the department, and must hold review hearings as described under RCW 13.40.185 (3).": 1, "A disposition outside the standard range shall be determinate , subject to the review hearings in RCW 13.40.185 (3) when appropriate, and shall be comprised of confinement or community supervision, or a combination thereof.": 1, "A proposed treatment plan shall be provided and shall include, at a minimum: (i) The frequency and type of contact between the offender and therapist;": 1, "The respondent shall not change sex offender treatment providers or treatment conditions without first notifying the prosecutor, the probation counselor, and the court, and shall not change providers without court approval after a hearing if the prosecutor or probation counselor object to the change;": 1, "A proposed treatment plan shall be provided and shall include, at a minimum: (a) Whether inpatient and/or outpatient treatment is recommended;": 1, "(3) Excluding the offenses listed in RCW 13.40.160 (1)(b), the juvenile court maintains concurrent jurisdiction over a juvenile who is committed to the department and shall schedule review hearings every six months that the juvenile is in the custody of a juvenile rehabilitation facility to assess the youth's progress.": 1, "(b) During each review hearing the court shall consider the juvenile's progress and shall release the juvenile from the custody of the department and place the juvenile on up to a year of community supervision, unless: (i) The juvenile will be placed on mandatory parole; or (ii) The court makes a finding under RCW 13.40.160 (1)(c).": 1, "Information regarding victims, next of kin, or witnesses requesting the notice, information regarding any other person specified in writing by the prosecuting attorney to receive the notice, and the notice are confidential and shall not be available to the juvenile.": 1, "(8)(a) Except as provided in (b) of this subsection, the minimum allocation for each school district shall include allocations per annual average full-time equivalent student for the following materials, supplies, and operating costs as provided in the 2023-24 school year, after which the allocations shall be adjusted annually for inflation as specified in the omnibus appropriations act: Per annual average full-time equivalent student in grades K-12 Technology. . . . $178.98 Utilities and insurance. . . . $430.26 Curriculum and textbooks. . . . $164.48 Other supplies . . . . $326.54 Library materials. . . .$22.65 Instructional professional development for certificated and classified staff. . . . $28.94 Facilities maintenance. . . . $206.22 Security and central office administration. . . . $146.37 (b) In addition to the amounts provided in (a) of this subsection, beginning in the 2023-24 school year, the omnibus appropriations act shall provide the following minimum allocation for each annual average full-time equivalent student in grades nine through 12 for the following materials, supplies, and operating costs, to be adjusted annually for inflation: Per annual average full-time equivalent student in grades 9-12 Technology. . . .$44.05 Curriculum and textbooks. . . .$48.06 Other supplies . . . . $94.07 Library materials. . . .$6.05 Instructional professional development for certificated and classified staff. . . .$8.01 (c) The increased allocation amount of $21 per annual average full-time equivalent student for materials, supplies, and operating costs provided under (a) of this subsection is intended to address growing costs in the enumerated categories and may not be expended for any other purpose.": 1, "The definition of full-time equivalent student shall be determined by rules of the superintendent of public instruction and shall be included as part of the superintendent's biennial budget request.": 1, "(3) Household income information received by the office of the superintendent of public instruction, school employees, school district employees, or their designees in accordance with this section is exempt from disclosure under chapter 42.56 RCW and may not be disseminated except as provided by law.": 1, "(4) The bonuses provided under this section are in addition to compensation received under a district's salary schedule adopted in accordance with RCW 28A.405.200 and shall not be included in calculations of a district's average salary and associated salary limitations under RCW 28A.400.200 .": 1, "Any commercial development or redevelopment within a mixed-use area must be principally designed to serve the existing and projected rural population and must meet the following requirements: (I) Any included retail or food service space must not exceed the footprint of previously occupied space or 5,000 square feet, whichever is greater, for the same or similar use, unless the retail space is for an essential rural retail service and the designated limited area is located at least 10 miles from an existing urban growth area, then the retail space must not exceed the footprint of the previously occupied space or 10,000 square feet, whichever is greater; and (II) Any included retail or food service space must not exceed 2,500 square feet for a new use, unless the new retail space is for an essential rural retail service and the designated limited area is located at least 10 miles from an existing urban growth area, then the new retail space must not exceed 10,000 square feet;": 1, "Public services and public facilities shall be limited to those necessary to serve the recreation or tourist use and shall be provided in a manner that does not permit low-density sprawl;": 1, "Public services and public facilities shall be limited to those necessary to serve the isolated nonresidential use and shall be provided in a manner that does not permit low-density sprawl;": 1, "(6)(a) Documents prepared by or for the council are inadmissible and may not be used in a civil or administrative proceeding, except that any document that exists before its use or consideration in a review by the council, or that is created independently of such review, does not become inadmissible merely because it is reviewed or used by the council.": 1, "(b) Upon receipt of a report from an insurer made pursuant to (a) of this subsection, the local or tribal law enforcement agency shall timely share all information received from the insurer with the individual responsible for fire investigation under RCW 43.44.050 (1), and shall coordinate with that individual consistent with RCW 43.44.050 .": 1, "Every other company subject to regulation by the commission, for which regulatory fees are not otherwise fixed by law shall pay fees as herein provided and shall constitute additional classes according to kinds of businesses engaged in.": 1, "(12) Effective January 1, 2024, the authority shall require coverage for noninvasive preventive colorectal cancer screening tests assigned either a grade of A or grade of B by the United States preventive services task force and shall require coverage for colonoscopies performed as a result of a positive result from such a test.": 1, "The department must perform the collection of such taxes on behalf of the city at no cost to the city and must remit the tax to the city as provided in RCW 82.14.060 .": 1, "(e) Notwithstanding any other provision of law, all firearm enhancements under this section are mandatory, shall be served in total confinement, and shall run consecutively to all other sentencing provisions, including other firearm or deadly weapon enhancements, for all offenses sentenced under this chapter.": 1, "(e) Notwithstanding any other provision of law, all deadly weapon enhancements under this section are mandatory, shall be served in total confinement, and shall run consecutively to all other sentencing provisions, including other firearm or deadly weapon enhancements, for all offenses sentenced under this chapter.": 1, "Notwithstanding any other provision of law, all impaired driving enhancements under this subsection are mandatory, shall be served in total confinement, and shall run consecutively to all other sentencing provisions, including other impaired driving enhancements, for all offenses sentenced under this chapter.": 1, "(b) Notwithstanding any other provision of law, all sexual motivation enhancements under this subsection are mandatory, shall be served in total confinement, and shall run consecutively to all other sentencing provisions, including other sexual motivation enhancements, for all offenses sentenced under this chapter.": 1, "These enhancements shall be mandatory, shall be served in total confinement, and shall run consecutively to all other sentencing provisions, including other minor child enhancements, for all offenses sentenced under this chapter.": 1, "If the addition of a minor child enhancement increases the sentence so that it would exceed the statutory maximum for the offense, the portion of the sentence representing the enhancement shall be mandatory, shall be served in total confinement, and shall run consecutively to all other sentencing provisions.": 1, "RCW 67.16.102 and 2009 c 87 s 1 are each amended to read as follows: (1) Notwithstanding any other provision of this chapter to the contrary, the licensee shall withhold and shall pay daily to the commission, in addition to the percentages authorized by RCW 67.16.105 , one percent of the gross receipts of all parimutuel machines at each race meet which sums shall, at the end of each meet, be paid by the commission to the licensed owners of those Washington bred only horses finishing first, second, third, and fourth at each meet from which the additional one percent is derived in accordance with an equitable distribution formula to be promulgated by the commission prior to the commencement of each race meet: PROVIDED, That nothing in this section shall apply to race meets which are nonprofit in nature, are of ten days or less, and have an average daily handle of less than one hundred twenty thousand dollars.": 1, "With the prior approval of the commission, the class 1 racing association may participate in a multijurisdictional common pool and may change its commission and breakage rates to achieve a common rate with other participants in the common pool.": 1, "A new section is added to chapter 28A.655 RCW to read as follows: (1) By September 1, 2028, the office of the superintendent of public instruction shall adopt Asian American and Native Hawaiian/Pacific Islander history learning standards as part of the state social studies learning standards and shall identify available curricula and other instructional materials that are aligned to those standards for use by school districts and collected in collaboration with leaders of Asian American and Native Hawaiian/Pacific Islander community-based organizations and the statewide association of educational service districts.": 1, "(5) Applications for certification shall be upon forms prescribed by the council and shall be supported by such information and technical studies as the council may require.": 1, "The plan must describe how the qualifying port district plans to apply the principles of environmental justice to port district activities and must guide the qualifying port district in its implementation of its obligations under this chapter.": 1, "(2) A qualifying port district must regularly review their compliance with existing laws and policies that guide community engagement and must comply with the following: (a) Title VI of the civil rights act, prohibiting discrimination based on race, color, or national origin and requiring meaningful access for people with limited English proficiency, and disability;": 1, "A qualifying port district may expend funds for remediation and mitigation, and may participate in and expend funds for programs to identify, study, and make recommendations for remediation and mitigation of environmental impacts and cumulative environmental health impacts that result or are expected to result from the port district's use of the authority granted herein.": 1, "(16) Notwithstanding the provisions of subsection (14) of this section, may receive such gifts, grants, conveyances, devises, and bequests of real or personal property from private sources as may be made from time to time, in trust or otherwise, whenever the terms and conditions thereof will aid in carrying out the community and technical college programs and may sell, lease or exchange, invest or expend the same or the proceeds, rents, profits and income thereof according to the terms and conditions thereof; and adopt regulations to govern the receipt and expenditure of the proceeds, rents, profits and income thereof; and (17) The college board shall have the power of eminent domain.": 1, "Once filed, the exemption is valid for six years or eight years and may not be renewed.": 1, "(b) A conviction vacated on or after July 28, 2019, qualifies as a prior conviction for the purpose of charging a present recidivist offense occurring on or after July 28, 2019, and may be used to establish an ongoing pattern of abuse for purposes of RCW 9.94A.535 . --- END ---": 1, "(5) Each final decision of a hearing examiner shall be in writing and shall include findings and conclusions, based on the record, to support the decision.": 1, "The following goals are not listed in order of priority and shall be used exclusively for the purpose of guiding the development of comprehensive plans, development regulations, and, where specified, regional plans, policies, and strategies: (1) Urban growth.": 1, "(7) Multicounty planning policies shall be adopted by two or more counties, each with a population of four hundred fifty thousand or more, with contiguous urban areas and may be adopted by other counties, according to the process established under this section or other processes agreed to among the counties and cities within the affected counties throughout the multicounty region.": 1, "(c) One of the public members shall be appointed by the governor as chair of the board and shall serve as chair at the pleasure of the governor.": 1, "The executive director must be funded in the office of the state treasurer budget and shall administer and operate the Washington state public bank.": 1, "(14) Any owner of bonds of the public bank issued under this chapter, and the trustee under any trust agreement or indenture, may, either at law or in equity, by suit, action, mandamus, or other proceeding, protect and enforce any of their respective rights, and may become the purchaser at any foreclosure sale if the person is the highest bidder, except to the extent the rights given are restricted by the public bank in any bond resolution or trust agreement or indenture authorizing the issuance of the bonds.": 1, "The state treasurer may purchase such bonds or warrants directly from the taxing district or in the open market at such prices and upon such terms as it may determine, and may sell them at such times as it deems advisable;": 1, "(4) The petitioner must allege specific facts based on personal observation, evaluation, or investigation, and must consider the reliability or credibility of any person providing information material to the petition.": 1, "If an involuntary less restrictive alternative is sought, the petition shall state facts that support the finding that such person, as a result of a behavioral health disorder, presents a likelihood of serious harm or is gravely disabled and shall set forth any recommendations for less restrictive alternative treatment services; and (5) A copy of the petition has been served on the detained person, his or her attorney, and his or her guardian, if any, prior to the probable cause hearing; and (6) The court at the time the petition was filed and before the probable cause hearing has appointed counsel to represent such person if no other counsel has appeared; and (7) The petition reflects that the person was informed of the loss of firearm rights if involuntarily committed for mental health treatment; and (8) At the conclusion of the initial commitment period, the professional staff of the agency or facility or the designated crisis responder may petition for an additional period of either 90 days of less restrictive alternative treatment or 90 days of involuntary intensive treatment as provided in RCW 71.05.290 ; and (9) If the hospital or facility designated to provide less restrictive alternative treatment is other than the facility providing involuntary treatment, the outpatient facility so designated to provide less restrictive alternative treatment has agreed to assume such responsibility.": 1, "(2) The credit may be used against any tax due under this chapter, and may be carried over until used, except as provided in subsection (4) of this section.": 1, "(13) The direct cost of foreclosure and sale of real property, and the direct fees and costs of distraint and sale of personal property, for delinquent taxes, must, when collected, be credited to the operation and maintenance fund of the county treasurer prosecuting the foreclosure or distraint or sale; and must be used by the county treasurer as a revolving fund to defray the cost of further foreclosure, distraint, and sale because of delinquent taxes without regard to budget limitations and not subject to indirect costs of other charges.": 1, "Regulations adopted under this subsection may not prohibit uses legally existing on any parcel prior to their adoption and shall remain in effect until the county or city adopts development regulations pursuant to RCW 36.70A.040 .": 0, "(3) Such counties and cities shall review these designations and development regulations when adopting their comprehensive plans under RCW 36.70A.040 and implementing development regulations under RCW 36.70A.120 and may alter such designations and development regulations to ensure consistency.": 1, "The prosecuting agency shall represent the state and shall have a right to a jury trial and to have the committed person evaluated by experts chosen by the state.": 1, "These conditions shall be individualized to address the person's specific risk factors and criminogenic needs and may include, but are not limited to, the following: Specification of residence or restrictions on residence including distance restrictions, specification of contact with a reasonable number of individuals upon the person's request who are verified by the department of corrections to be appropriate social contacts, prohibition of contact with potential or past victims, prohibition of alcohol and other drug use, participation in a specific course of inpatient or outpatient treatment that may include monitoring by the use of polygraph and plethysmograph, monitoring through the use of global positioning system technology, supervision by a department of corrections community corrections officer, a requirement that the person remain within the state or other stipulated geographically bounded area unless the person receives prior authorization by the court, and any other conditions that the court determines are in the best interest of the person or others.": 1, "(b) The court shall be notified before the close of the next judicial day that the person has been taken into custody and shall promptly schedule a hearing.": 1, "Payments shall be made on a fee-for-service basis and shall be equal to the applicable medicare rates for the same services.": 1, "(2) A local health jurisdiction shall convene no less than once per calendar quarter and shall include representation from primary care providers, community health workers, behavioral health specialists, patient advocates, and local public health officials.": 1, "The dashboard shall be updated quarterly and shall include metrics related to access, quality, equity, and cost.": 1}`);

// ─── Fail-safe emptiness check — mirrors isEffectivelyEmptyAction in pipeline.js ───

const CONNECTIVE_WORDS = new Set([
  "and", "or", "but", "the", "a", "an", "to", "of", "in", "on", "for",
  "with", "by", "as", "at", "from", "this", "that", "it", "its",
  "be", "been", "is", "are", "was", "were",
]);

function isEffectivelyEmptyAction(action) {
  if (!action) return true;
  const stripped = action.replace(/[.,;:()\-–—]/g, " ").trim();
  if (!stripped) return true;
  const words = stripped.split(/\s+/).filter(Boolean);
  return words.every((w) => CONNECTIVE_WORDS.has(w.toLowerCase()));
}

// ─── The candidate rule's trigger — unchanged from rounds 1-3 ──────────────

const TRIGGER_RE = /([,;]\s*)?\band\b\s+(shall|must|may)\b(\s+not\b)?/gi;

function findTriggers(sentence) {
  return [...sentence.matchAll(TRIGGER_RE)].map((m) => ({
    index: m.index,
    endIndex: m.index + m[0].length,
    force: m[2].toLowerCase(),
    negation: !!m[3],
    raw: m[0],
  }));
}

function detectLeadingForce(text) {
  const m = text.match(/\b(shall|must|may|will|should)\b(\s+not\b)?/i);
  if (!m) return { force: null, negation: false };
  return { force: m[1].toLowerCase(), negation: !!m[2] };
}

// ─── CHANGE 1: look through an infinitive on a no-actor verb ───────────────

const PARTICIPLE_IRREGULAR = new Set([
  "given", "shown", "taken", "made", "done", "known", "seen", "held", "kept",
  "sent", "built", "brought", "bought", "found", "paid", "said", "told",
  "sold", "begun", "broken", "chosen", "driven", "written", "spoken",
  "stolen", "worn", "torn", "grown", "thrown", "drawn", "flown", "set",
  "lost",
]);

function isParticiple(word) {
  const w = word.toLowerCase();
  return /ed$/.test(w) || PARTICIPLE_IRREGULAR.has(w);
}

const NO_ACTOR_VERBS = new Set([
  "occur", "occurs", "exist", "exists", "happen", "happens", "remain",
  "remains", "continue", "continues", "lapse", "lapses", "expire", "expires",
  "consist", "consists", "apply", "applies", "differ", "differs", "arise",
  "arises", "result", "results",
]);

function firstWord(text) {
  const m = (text || "").trim().match(/^[a-zA-Z]+/);
  return m ? m[0].toLowerCase() : null;
}

function classifySecondHalfVerb(duty2Candidate) {
  const words = duty2Candidate.trim().split(/\s+/);
  const w1 = firstWord(words[0] || "");
  if (!w1) return { type: "none", verb: null, evaluatedVerb: null, lookThrough: false };

  if (w1 === "be") {
    const w2 = firstWord(words[1] || "");
    if (w2 && isParticiple(w2)) return { type: "passive", verb: `be ${w2}`, evaluatedVerb: `be ${w2}`, lookThrough: false };
    return { type: "copula", verb: `be ${w2 || ""}`.trim(), evaluatedVerb: `be ${w2 || ""}`.trim(), lookThrough: false };
  }

  if (NO_ACTOR_VERBS.has(w1)) {
    // CHANGE 1: look through "<no-actor verb> to <later verb>"
    const w2 = firstWord(words[1] || "");
    if (w2 === "to") {
      const w3 = firstWord(words[2] || "");
      if (w3) {
        if (w3 === "be") {
          // "continue/remain to be [X]" is still describing an ongoing
          // state, not a new action -- does NOT get the top-level
          // be+participle-is-always-passive exception.
          const w4 = firstWord(words[3] || "");
          return { type: "no_actor", verb: w1, evaluatedVerb: `be ${w4 || ""}`.trim(), lookThrough: true };
        }
        if (NO_ACTOR_VERBS.has(w3)) {
          return { type: "no_actor", verb: w1, evaluatedVerb: w3, lookThrough: true };
        }
        return { type: "active", verb: w1, evaluatedVerb: w3, lookThrough: true };
      }
    }
    return { type: "no_actor", verb: w1, evaluatedVerb: w1, lookThrough: false };
  }

  return { type: "active", verb: w1, evaluatedVerb: w1, lookThrough: false };
}

// ─── CHANGE 2: shared-ending guard -- first half must not end on a bare "to" ───

const BARE_TO_ENDING_RE = /,?\s*to\s*$/i;
function endsWithBareTo(duty1Assigned) {
  return BARE_TO_ENDING_RE.test(duty1Assigned);
}

// REPORT-ONLY: other prepositions/particles that might also leave the first
// half looking unfinished -- not blocked, just surfaced per the task's ask.
const OTHER_INCOMPLETE_ENDINGS = new Set([
  "for", "of", "in", "on", "at", "with", "as", "into", "upon", "from",
  "by", "under", "than", "that", "which", "who",
]);
function endsWithOtherIncompleteWord(duty1Assigned) {
  const words = duty1Assigned.trim().replace(/[.,;:]+$/, "").split(/\s+/);
  const last = (words[words.length - 1] || "").toLowerCase();
  return OTHER_INCOMPLETE_ENDINGS.has(last) ? last : null;
}

// ─── Control tags evaluated at the trigger ─────────────────────────────────
// CHANGE 3: AND_MAY_BE_PASSIVE is retired. Rounds 2-3 established that a
// passive second half is performed by someone even when nobody is named,
// so a passive split is correct, not a false positive -- round 3 flagged 53
// such splits as "control group" and every one checked was a genuine duty.
// It is no longer tagged or reported here at all.

function checkAsMayBe(sentence, trigger) {
  const windowStart = Math.max(0, trigger.index - 25);
  const window = sentence.slice(windowStart, trigger.endIndex + 10);
  return /\bas\b[\s\S]{0,20}?\bmay\s+be\b/i.test(window);
}

function checkAndWill(sentence, trigger) {
  const windowStart = Math.max(0, trigger.index - 15);
  const window = sentence.slice(windowStart, trigger.endIndex + 15);
  return /\band\s+will\b/i.test(window);
}

function controlTagsAtTrigger(sentence, trigger) {
  const tags = [];
  if (checkAsMayBe(sentence, trigger)) tags.push("AS_MAY_BE");
  if (checkAndWill(sentence, trigger)) tags.push("AND_WILL");
  return tags;
}

// ─── "By" phrase naming an acting party, recorded but not acted on ────────

const BY_ACTOR_RE = /\bby\s+([a-z][\w\s'’-]{0,60}?)(?=[,.;:]| and\b| or\b|$)/i;
function hasByActorPhrase(sentence) {
  return BY_ACTOR_RE.test(sentence);
}

// ─── Apply the candidate rule to one sentence ──────────────────────────────

function applyRule(sentence) {
  const triggers = findTriggers(sentence);
  const triggerRecords = [];
  const duties = [];
  let currentStart = 0;
  let pendingForce = null;
  let splitsPerformed = 0;
  let failSafeBlocks = 0;
  let sharedEndingBlocks = 0;
  let noActorBlocks = 0;
  const forcePairs = [];
  const copulaFlags = [];
  const noForceFirstHalves = [];
  const otherIncompleteFlags = [];
  let previousDutyForceLabel = null;

  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];
    const duty1ForTest = sentence.slice(0, trigger.index).trim();
    const duty1Assigned = sentence.slice(currentStart, trigger.index).trim();
    const nextBoundary = i + 1 < triggers.length ? triggers[i + 1].index : sentence.length;
    const duty2Candidate = sentence.slice(trigger.endIndex, nextBoundary).trim();
    const tags = controlTagsAtTrigger(sentence, trigger);

    const isDuty1Empty = isEffectivelyEmptyAction(duty1ForTest);
    const isDuty2Empty = isEffectivelyEmptyAction(duty2Candidate);

    if (isDuty1Empty || isDuty2Empty) {
      failSafeBlocks++;
      triggerRecords.push({
        trigger, tags, decision: "blocked", reason: "FAILSAFE_EMPTY_SIDE",
        duty1Assigned, duty2Candidate,
      });
      continue;
    }

    if (endsWithBareTo(duty1Assigned)) {
      sharedEndingBlocks++;
      triggerRecords.push({
        trigger, tags, decision: "blocked", reason: "SHARED_ENDING",
        duty1Assigned, duty2Candidate,
      });
      continue;
    }
    const otherIncomplete = endsWithOtherIncompleteWord(duty1Assigned);
    if (otherIncomplete) {
      otherIncompleteFlags.push({ word: otherIncomplete, duty1Assigned, duty2Candidate });
    }

    const verbInfo = classifySecondHalfVerb(duty2Candidate);
    if (verbInfo.type === "copula") {
      copulaFlags.push({ verb: verbInfo.verb, duty2Candidate });
    }

    if (verbInfo.type === "no_actor") {
      noActorBlocks++;
      triggerRecords.push({
        trigger, tags, decision: "blocked", reason: "SECOND_SIDE_NO_ACTOR",
        duty1Assigned, duty2Candidate, verbInfo,
      });
      continue;
    }

    const finalizedForce = pendingForce || detectLeadingForce(duty1Assigned);
    if (!pendingForce && !finalizedForce.force) {
      noForceFirstHalves.push({ duty1Assigned });
    }
    const isPassive = verbInfo.type === "passive";
    const byActorAnywhere = hasByActorPhrase(sentence);
    duties.push({
      text: duty1Assigned, force: finalizedForce.force, negation: finalizedForce.negation,
    });

    const beforeLabel = previousDutyForceLabel || (finalizedForce.force ? `${finalizedForce.force}${finalizedForce.negation ? "_not" : ""}` : "UNKNOWN");
    const afterLabel = `${trigger.force}${trigger.negation ? "_not" : ""}`;
    forcePairs.push(`${beforeLabel} -> ${afterLabel}`);
    previousDutyForceLabel = afterLabel;

    triggerRecords.push({
      trigger, tags, decision: "split", reason: null,
      duty1Assigned, duty2Candidate, verbInfo, isPassive, byActorAnywhere,
    });

    currentStart = trigger.endIndex;
    pendingForce = { force: trigger.force, negation: trigger.negation };
    splitsPerformed++;
  }

  const finalText = sentence.slice(currentStart).trim();
  const finalForce = pendingForce || detectLeadingForce(finalText);
  duties.push({ text: finalText, force: finalForce.force, negation: finalForce.negation });

  return {
    triggers, triggerRecords, duties, splitsPerformed,
    failSafeBlocks, sharedEndingBlocks, noActorBlocks, forcePairs,
    copulaFlags, noForceFirstHalves, otherIncompleteFlags,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const out = [];
const log = (line = "") => out.push(line);

log(`Pool size (excluding sentinels, no-document bills, and 4000-4999/8000-8999 ranges): ${pool.length}`);
log(`Sampling every ${step} bills, ${batch.length} bills total (${batch.length} bills sampled -- must match rounds 1-3's 212): ${batch.join(", ")}\n`);

const seen = new Map();
let billsFetchedOk = 0;
let candidateCount = 0;

for (const billNumber of batch) {
  let data;
  try {
    data = await fetchBillTextData(String(billNumber), BIENNIUM);
  } catch (err) {
    log(`Bill ${billNumber}: SKIP — ${err.message}`);
    continue;
  }
  billsFetchedOk++;
  for (const section of data.sections || []) {
    if (!section.text?.trim()) continue;
    for (const sentence of splitSentences(section.text)) {
      const realTriggers = findTriggers(sentence);
      if (realTriggers.length === 0) continue;
      candidateCount++;
      if (seen.has(sentence)) {
        seen.get(sentence).occurrences.push({ bill: billNumber, section: section.id });
        continue;
      }
      const result = applyRule(sentence);
      seen.set(sentence, { result, occurrences: [{ bill: billNumber, section: section.id }] });
    }
  }
}

log(`Total candidate sentences (with duplicates): ${candidateCount}`);
log(`Distinct sentences after dedup: ${seen.size}\n`);

let totalSplits = 0;
let totalFailSafe = 0;
let totalSharedEnding = 0;
let totalNoActor = 0;
const forcePairCounts = {};
const controlGroupSplitEntries = [];
const sharedEndingEntries = [];
const noActorBlockedEntries = [];
const copulaReportEntries = [];
const noForceFirstHalfEntries = [];
const otherIncompleteEntries = [];
let newlyAllowed = 0;
let newlyBlocked = 0;
let unchangedCount = 0;
let comparedCount = 0;
const changedEntries = [];

let idx = 0;
for (const [sentence, { result, occurrences }] of seen.entries()) {
  idx++;
  const {
    triggers, triggerRecords, duties, splitsPerformed, failSafeBlocks,
    sharedEndingBlocks, noActorBlocks, forcePairs, copulaFlags,
    noForceFirstHalves, otherIncompleteFlags,
  } = result;

  totalSplits += splitsPerformed;
  totalFailSafe += failSafeBlocks;
  totalSharedEnding += sharedEndingBlocks;
  totalNoActor += noActorBlocks;
  for (const pair of forcePairs) {
    forcePairCounts[pair] = (forcePairCounts[pair] || 0) + 1;
  }

  const key = singleLine(sentence);
  if (Object.prototype.hasOwnProperty.call(ROUND3_BASELINE, key)) {
    comparedCount++;
    const prevSplits = ROUND3_BASELINE[key];
    if (splitsPerformed > prevSplits) {
      newlyAllowed++;
      changedEntries.push({ sentence, direction: "newly-allowed", prevSplits, nowSplits: splitsPerformed, occurrences });
    } else if (splitsPerformed < prevSplits) {
      newlyBlocked++;
      changedEntries.push({ sentence, direction: "newly-blocked", prevSplits, nowSplits: splitsPerformed, occurrences });
    } else {
      unchangedCount++;
    }
  }

  for (const tr of triggerRecords) {
    if (tr.decision === "split" && tr.tags.length > 0) {
      controlGroupSplitEntries.push({ sentence, occurrences, trigger: tr });
    }
    if (tr.reason === "SHARED_ENDING") {
      sharedEndingEntries.push({ sentence, occurrences, trigger: tr });
    }
    if (tr.reason === "SECOND_SIDE_NO_ACTOR") {
      noActorBlockedEntries.push({ sentence, occurrences, trigger: tr });
    }
  }
  for (const cf of copulaFlags) {
    copulaReportEntries.push({ sentence, occurrences, verb: cf.verb, duty2: cf.duty2Candidate });
  }
  for (const nf of noForceFirstHalves) {
    noForceFirstHalfEntries.push({ sentence, occurrences, duty1: nf.duty1Assigned });
  }
  for (const oi of otherIncompleteFlags) {
    otherIncompleteEntries.push({ sentence, occurrences, word: oi.word, duty1: oi.duty1Assigned, duty2: oi.duty2Candidate });
  }

  const firstOcc = occurrences[0];
  const dupNote = occurrences.length > 1
    ? ` [appeared in ${occurrences.length} places: ${occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";

  log(`--- RESULT ${idx} — bill ${firstOcc.bill}, section ${firstOcc.section}, triggers=${triggers.length}, splits=${splitsPerformed}, failsafe_blocked=${failSafeBlocks}, shared_ending_blocked=${sharedEndingBlocks}, no_actor_blocked=${noActorBlocks}${dupNote} ---`);
  log(`sentence: ${singleLine(sentence)}`);
  for (const tr of triggerRecords) {
    const tagLabel = tr.tags.length ? tr.tags.join(",") : "none";
    const extra = tr.decision === "split"
      ? ` passive=${tr.isPassive} by_actor_anywhere=${tr.byActorAnywhere} verb=${tr.verbInfo.verb} evaluated_verb=${tr.verbInfo.evaluatedVerb} look_through=${tr.verbInfo.lookThrough}`
      : tr.verbInfo ? ` verb=${tr.verbInfo.verb} evaluated_verb=${tr.verbInfo.evaluatedVerb} look_through=${tr.verbInfo.lookThrough}` : "";
    log(`  trigger @${tr.trigger.index} "${tr.trigger.raw.trim()}" force=${tr.trigger.force}${tr.trigger.negation ? "_not" : ""} decision=${tr.decision}${tr.reason ? `(${tr.reason})` : ""} control=[${tagLabel}]${extra}`);
    log(`    side1: ${singleLine(tr.duty1Assigned)}`);
    log(`    side2: ${singleLine(tr.duty2Candidate)}`);
  }
  log(`  resulting duties (${duties.length}):`);
  duties.forEach((d, i) => {
    const forceLabel = d.force ? `${d.force}${d.negation ? "_not" : ""}` : "UNKNOWN";
    log(`    duty ${i + 1} [${forceLabel}]: ${singleLine(d.text)}`);
  });
  log("");
}

log("\nSummary:");
log(`  total distinct sentences: ${seen.size}`);
log(`  total splits performed: ${totalSplits}`);
log(`  total FAILSAFE_EMPTY_SIDE blocks: ${totalFailSafe}`);
log(`  total SHARED_ENDING blocks: ${totalSharedEnding}`);
log(`  total SECOND_SIDE_NO_ACTOR blocks: ${totalNoActor}`);

log(`\nForce-word pair breakdown (first half force -> second half force), per split event:`);
for (const [pair, count] of Object.entries(forcePairCounts).sort((a, b) => b[1] - a[1])) {
  log(`  ${pair}: ${count}`);
}

log(`\nRound-over-round comparison:`);
log(`  round 3 total splits: ${ROUND3_TOTAL_SPLITS}, round 3 total blocks: ${ROUND3_TOTAL_BLOCKS}`);
log(`  round 4 total splits: ${totalSplits}, round 4 total blocks: ${totalFailSafe + totalSharedEnding + totalNoActor}`);
log(`  sentences compared against round 3 baseline: ${comparedCount}`);
log(`  newly-allowed (more splits than round 3): ${newlyAllowed}`);
log(`  newly-blocked (fewer splits than round 3): ${newlyBlocked}`);
log(`  unchanged: ${unchangedCount}`);

log(`\n\n=== CHANGED OUTCOMES vs round 3 (${changedEntries.length}) ===\n`);
changedEntries.forEach((e, i) => {
  const firstOcc = e.occurrences[0];
  log(`--- CHANGED ${i + 1} — bill ${firstOcc.bill}, section ${firstOcc.section}, ${e.direction}, round3_splits=${e.prevSplits}, round4_splits=${e.nowSplits} ---`);
  log(`sentence: ${singleLine(e.sentence)}`);
  log("");
});

log(`\n\n=== SHARED_ENDING blocks (${sharedEndingEntries.length}) ===\n`);
sharedEndingEntries.forEach((entry, i) => {
  const firstOcc = entry.occurrences[0];
  const dupNote = entry.occurrences.length > 1
    ? ` [appeared in ${entry.occurrences.length} places: ${entry.occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  log(`--- SHARED-ENDING ${i + 1} — bill ${firstOcc.bill}, section ${firstOcc.section}${dupNote} ---`);
  log(`sentence: ${singleLine(entry.sentence)}`);
  log(`  side1 (ends in bare "to"): ${singleLine(entry.trigger.duty1Assigned)}`);
  log(`  side2: ${singleLine(entry.trigger.duty2Candidate)}`);
  log("");
});

log(`\n\n=== REPORT-ONLY: possible incomplete first half, ending other than bare "to" (${otherIncompleteEntries.length}) ===`);
log(`(NOT blocked -- allowed. Flagged only because the first half's last word is a preposition/particle that may leave it unfinished.)\n`);
otherIncompleteEntries.forEach((entry, i) => {
  const firstOcc = entry.occurrences[0];
  log(`--- OTHER-INCOMPLETE ${i + 1} — bill ${firstOcc.bill}, section ${firstOcc.section}, last_word="${entry.word}" ---`);
  log(`sentence: ${singleLine(entry.sentence)}`);
  log(`  side1: ${singleLine(entry.duty1)}`);
  log(`  side2: ${singleLine(entry.duty2)}`);
  log("");
});

log(`\n\n=== SECOND_SIDE_NO_ACTOR blocks (${noActorBlockedEntries.length}) ===\n`);
noActorBlockedEntries.forEach((entry, i) => {
  const firstOcc = entry.occurrences[0];
  const dupNote = entry.occurrences.length > 1
    ? ` [appeared in ${entry.occurrences.length} places: ${entry.occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  log(`--- NO-ACTOR-BLOCKED ${i + 1} — bill ${firstOcc.bill}, section ${firstOcc.section}, verb=${entry.trigger.verbInfo.verb}, evaluated_verb=${entry.trigger.verbInfo.evaluatedVerb}, look_through=${entry.trigger.verbInfo.lookThrough}${dupNote} ---`);
  log(`sentence: ${singleLine(entry.sentence)}`);
  log(`  side2: ${singleLine(entry.trigger.duty2Candidate)}`);
  log("");
});

log(`\n\n=== REPORT-ONLY: "be X" copula cases, not passive, not in no-actor list (${copulaReportEntries.length}) ===`);
log(`(These are NOT blocked -- allowed per the literal rule.)\n`);
copulaReportEntries.forEach((entry, i) => {
  const firstOcc = entry.occurrences[0];
  log(`--- COPULA-FLAG ${i + 1} — bill ${firstOcc.bill}, section ${firstOcc.section}, verb="${entry.verb}" ---`);
  log(`sentence: ${singleLine(entry.sentence)}`);
  log(`  side2: ${singleLine(entry.duty2)}`);
  log("");
});

log(`\n\n=== RECORD-ONLY: splits whose FIRST half carries no requirement word (${noForceFirstHalfEntries.length}) ===`);
log(`(Not acted on this round -- how these should be presented to a reader is pending.)\n`);
noForceFirstHalfEntries.forEach((entry, i) => {
  const firstOcc = entry.occurrences[0];
  log(`--- NO-FORCE-FIRST-HALF ${i + 1} — bill ${firstOcc.bill}, section ${firstOcc.section} ---`);
  log(`sentence: ${singleLine(entry.sentence)}`);
  log(`  first half (no requirement word): ${singleLine(entry.duty1)}`);
  log("");
});

log(`\n\n=== CONTROL GROUP: real splits whose own trigger carries a control tag (${controlGroupSplitEntries.length}) ===\n`);
controlGroupSplitEntries.forEach((entry, i) => {
  const firstOcc = entry.occurrences[0];
  const dupNote = entry.occurrences.length > 1
    ? ` [appeared in ${entry.occurrences.length} places: ${entry.occurrences.map(o => `bill ${o.bill} ${o.section}`).join(", ")}]`
    : "";
  log(`--- CONTROL-SPLIT ${i + 1} — bill ${firstOcc.bill}, section ${firstOcc.section}, control=[${entry.trigger.tags.join(",")}]${dupNote} ---`);
  log(`sentence: ${singleLine(entry.sentence)}`);
  log(`  trigger: "${entry.trigger.trigger.raw.trim()}" force=${entry.trigger.trigger.force}${entry.trigger.trigger.negation ? "_not" : ""}`);
  log(`  side1: ${singleLine(entry.trigger.duty1Assigned)}`);
  log(`  side2: ${singleLine(entry.trigger.duty2Candidate)}`);
  log("");
});

log(`\nDone. ${batch.length} bills sampled, ${billsFetchedOk} bills fetched successfully, ${candidateCount} candidate sentences found (with duplicates), ${seen.size} distinct sentences classified, ${totalSplits} total splits, ${totalFailSafe} fail-safe blocks, ${totalSharedEnding} shared-ending blocks, ${totalNoActor} second-side-no-actor blocks, ${controlGroupSplitEntries.length} control-tagged splits, ${copulaReportEntries.length} copula report-only flags, ${noForceFirstHalfEntries.length} no-force-first-half splits, ${newlyAllowed} newly-allowed, ${newlyBlocked} newly-blocked, ${unchangedCount} unchanged (of ${comparedCount} compared to round 3).`);

writeFileSync(OUTPUT_FILE, out.join("\n"), "utf8");

console.log(`Pool size: ${pool.length}, sampled ${batch.length} bills, ${billsFetchedOk} fetched ok.`);
console.log(`Distinct candidate sentences: ${seen.size}. Total splits: ${totalSplits} (round 3: ${ROUND3_TOTAL_SPLITS}).`);
console.log(`Fail-safe blocks: ${totalFailSafe}. Shared-ending blocks: ${totalSharedEnding}. Second-side-no-actor blocks: ${totalNoActor}.`);
console.log(`Control-tagged real splits: ${controlGroupSplitEntries.length}. Copula report-only flags: ${copulaReportEntries.length}. No-force-first-half splits: ${noForceFirstHalfEntries.length}.`);
console.log(`vs round 3: newly-allowed=${newlyAllowed}, newly-blocked=${newlyBlocked}, unchanged=${unchangedCount} (of ${comparedCount} compared).`);
console.log(`Full results written to ${OUTPUT_FILE}`);
