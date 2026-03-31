// Industry Automation Examples & Savings Data
const industryData = {
  "accounting": {
    name: "Accounting/Bookkeeping",
    examples: [
      { process: "Invoice data extraction & entry", timeSaved: "20 hrs/week", savings: "$1,400/mo", processes: ["Receipt scanning & categorization", "Invoice matching & posting", "Payment reconciliation"] },
      { process: "Client financial reporting", timeSaved: "15 hrs/week", savings: "$1,050/mo", processes: ["Automated report generation", "Financial data compilation", "Client report distribution"] },
      { process: "Expense management & coding", timeSaved: "12 hrs/week", savings: "$840/mo", processes: ["Auto-categorize expenses", "Policy compliance checking", "Monthly reconciliation"] }
    ]
  },
  "real_estate": {
    name: "Real Estate/Property Management",
    examples: [
      { process: "Tenant communication & requests", timeSaved: "20 hrs/week", savings: "$1,400/mo", processes: ["Email triage & responses", "Maintenance request handling", "Rent reminder automation"] },
      { process: "Property listing management", timeSaved: "15 hrs/week", savings: "$1,050/mo", processes: ["Multi-platform listing updates", "Inspection scheduling", "Document distribution"] },
      { process: "Financial tracking & reporting", timeSaved: "12 hrs/week", savings: "$840/mo", processes: ["Rent tracking", "Expense monitoring", "Owner statements"] }
    ]
  },
  "ecommerce": {
    name: "E-Commerce/Retail",
    examples: [
      { process: "Customer service automation", timeSaved: "25 hrs/week", savings: "$1,750/mo", processes: ["FAQ responses", "Order status updates", "Return processing"] },
      { process: "Inventory management", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Stock level monitoring", "Auto-reordering", "Multi-channel sync"] },
      { process: "Social media & marketing", timeSaved: "15 hrs/week", savings: "$1,050/mo", processes: ["Post scheduling", "Comment responses", "Lead nurturing emails"] }
    ]
  },
  "healthcare": {
    name: "Healthcare/Medical Clinics",
    examples: [
      { process: "Patient appointment management", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Appointment confirmations", "Reminder notifications", "No-show follow-ups"] },
      { process: "Insurance & billing", timeSaved: "20 hrs/week", savings: "$1,400/mo", processes: ["Claim submission", "Insurance verification", "Payment processing"] },
      { process: "Patient communication", timeSaved: "12 hrs/week", savings: "$840/mo", processes: ["Intake forms", "Lab results distribution", "Follow-up care reminders"] }
    ]
  },
  "legal": {
    name: "Legal Services/Law Firms",
    examples: [
      { process: "Client intake & documentation", timeSaved: "22 hrs/week", savings: "$1,540/mo", processes: ["Intake form processing", "Document organization", "Client onboarding"] },
      { process: "Case management", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Deadline tracking", "Court date reminders", "Document assembly"] },
      { process: "Time tracking & billing", timeSaved: "15 hrs/week", savings: "$1,050/mo", processes: ["Timesheet processing", "Invoice generation", "Retainer management"] }
    ]
  },
  "marketing": {
    name: "Marketing Agencies",
    examples: [
      { process: "Campaign reporting", timeSaved: "20 hrs/week", savings: "$1,400/mo", processes: ["Ad performance compilation", "Report automation", "Client dashboards"] },
      { process: "Lead management", timeSaved: "16 hrs/week", savings: "$1,120/mo", processes: ["Lead capture & scoring", "CRM data entry", "Follow-up sequences"] },
      { process: "Social media management", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Post scheduling", "Engagement monitoring", "Content calendar management"] }
    ]
  },
  "cleaning": {
    name: "Cleaning Services",
    examples: [
      { process: "Job scheduling & confirmation", timeSaved: "12 hrs/week", savings: "$840/mo", processes: ["Booking confirmations", "Team scheduling", "Customer reminders"] },
      { process: "Invoice & payment tracking", timeSaved: "10 hrs/week", savings: "$700/mo", processes: ["Invoice generation", "Payment reminders", "Receipt reconciliation"] },
      { process: "Customer communication", timeSaved: "8 hrs/week", savings: "$560/mo", processes: ["New customer onboarding", "Service confirmations", "Feedback collection"] }
    ]
  },
  "trades": {
    name: "Plumbing/Trades",
    examples: [
      { process: "Job quotes & scheduling", timeSaved: "14 hrs/week", savings: "$980/mo", processes: ["Quote generation", "Job scheduling", "Customer confirmations"] },
      { process: "Invoice & cash flow", timeSaved: "12 hrs/week", savings: "$840/mo", processes: ["Invoice creation", "Payment tracking", "Expense monitoring"] },
      { process: "Customer follow-up", timeSaved: "10 hrs/week", savings: "$700/mo", processes: ["Post-job follow-ups", "Reviews requests", "Repeat booking reminders"] }
    ]
  },
  "consulting": {
    name: "Consulting Firms",
    examples: [
      { process: "Project management", timeSaved: "20 hrs/week", savings: "$1,400/mo", processes: ["Status report generation", "Deadline tracking", "Deliverable management"] },
      { process: "Proposal generation", timeSaved: "16 hrs/week", savings: "$1,120/mo", processes: ["Proposal templates", "Cost calculations", "Client distribution"] },
      { process: "Time tracking & billing", timeSaved: "15 hrs/week", savings: "$1,050/mo", processes: ["Timesheet management", "Invoice generation", "Project tracking"] }
    ]
  },
  "dental": {
    name: "Dental Practices",
    examples: [
      { process: "Patient management", timeSaved: "16 hrs/week", savings: "$1,120/mo", processes: ["Appointment confirmations", "Reminders & recalls", "New patient intake"] },
      { process: "Insurance processing", timeSaved: "14 hrs/week", savings: "$980/mo", processes: ["Insurance verification", "Claim submission", "Payment tracking"] },
      { process: "Treatment planning & follow-up", timeSaved: "10 hrs/week", savings: "$700/mo", processes: ["Treatment reminders", "Follow-up care", "Payment reminders"] }
    ]
  },
  "beauty": {
    name: "Hair/Beauty Services",
    examples: [
      { process: "Appointment management", timeSaved: "14 hrs/week", savings: "$980/mo", processes: ["Booking confirmations", "Reminder texts", "Cancellation handling"] },
      { process: "Client communication", timeSaved: "10 hrs/week", savings: "$700/mo", processes: ["Follow-up messages", "Special offers", "New service promotions"] },
      { process: "Staff scheduling", timeSaved: "8 hrs/week", savings: "$560/mo", processes: ["Schedule optimization", "Staff notifications", "Shift management"] }
    ]
  },
  "restaurant": {
    name: "Restaurant/Cafe",
    examples: [
      { process: "Reservation & ordering", timeSaved: "16 hrs/week", savings: "$1,120/mo", processes: ["Booking confirmations", "Table management", "Online orders"] },
      { process: "Supplier & inventory", timeSaved: "12 hrs/week", savings: "$840/mo", processes: ["Stock level tracking", "Supplier ordering", "Inventory reconciliation"] },
      { process: "Staff scheduling", timeSaved: "10 hrs/week", savings: "$700/mo", processes: ["Schedule creation", "Staff notifications", "Shift swaps"] }
    ]
  },
  "fitness": {
    name: "Fitness/Gym",
    examples: [
      { process: "Member management", timeSaved: "14 hrs/week", savings: "$980/mo", processes: ["Membership tracking", "Renewal reminders", "Class scheduling"] },
      { process: "Payment processing", timeSaved: "12 hrs/week", savings: "$840/mo", processes: ["Invoice generation", "Payment reminders", "Cancellation management"] },
      { process: "Class scheduling & notifications", timeSaved: "10 hrs/week", savings: "$700/mo", processes: ["Class confirmations", "Instructor notifications", "Member reminders"] }
    ]
  },
  "education": {
    name: "Educational Services/Training",
    examples: [
      { process: "Student enrollment & tracking", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Enrollment forms", "Student data management", "Progress tracking"] },
      { process: "Course management", timeSaved: "16 hrs/week", savings: "$1,120/mo", processes: ["Schedule updates", "Material distribution", "Attendance tracking"] },
      { process: "Payment & invoicing", timeSaved: "12 hrs/week", savings: "$840/mo", processes: ["Invoice generation", "Payment tracking", "Refund processing"] }
    ]
  },
  "insurance": {
    name: "Insurance",
    examples: [
      { process: "Claim processing", timeSaved: "22 hrs/week", savings: "$1,540/mo", processes: ["Claim data entry", "Document collection", "Status updates"] },
      { process: "Policy management", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Policy renewals", "Quote generation", "Document management"] },
      { process: "Customer communication", timeSaved: "14 hrs/week", savings: "$980/mo", processes: ["Claims updates", "Premium reminders", "Service notifications"] }
    ]
  },
  "recruitment": {
    name: "Recruitment/HR",
    examples: [
      { process: "Candidate management", timeSaved: "20 hrs/week", savings: "$1,400/mo", processes: ["Application screening", "Interview scheduling", "Candidate communications"] },
      { process: "Onboarding", timeSaved: "16 hrs/week", savings: "$1,120/mo", processes: ["New hire documents", "Training materials", "Task assignments"] },
      { process: "Employee administration", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Timesheet processing", "Payroll prep", "Leave tracking"] }
    ]
  },
  "it_services": {
    name: "IT Services/Support",
    examples: [
      { process: "Ticket management", timeSaved: "20 hrs/week", savings: "$1,400/mo", processes: ["Ticket triage", "Status updates", "Customer notifications"] },
      { process: "Project tracking", timeSaved: "16 hrs/week", savings: "$1,120/mo", processes: ["Status reports", "Milestone tracking", "Client updates"] },
      { process: "Invoicing & time tracking", timeSaved: "14 hrs/week", savings: "$980/mo", processes: ["Timesheet processing", "Invoice generation", "Project costing"] }
    ]
  },
  "hospitality": {
    name: "Hospitality/Hotels",
    examples: [
      { process: "Guest management", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Booking confirmations", "Check-in automation", "Request handling"] },
      { process: "Housekeeping coordination", timeSaved: "14 hrs/week", savings: "$980/mo", processes: ["Room status tracking", "Team scheduling", "Quality assurance"] },
      { process: "Billing & payments", timeSaved: "12 hrs/week", savings: "$840/mo", processes: ["Invoice generation", "Payment processing", "Expense tracking"] }
    ]
  },
  "manufacturing": {
    name: "Manufacturing",
    examples: [
      { process: "Order processing", timeSaved: "20 hrs/week", savings: "$1,400/mo", processes: ["Order entry", "Inventory checking", "Production scheduling"] },
      { process: "Supply chain & inventory", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Stock tracking", "Supplier ordering", "Delivery coordination"] },
      { process: "Quality & shipping", timeSaved: "14 hrs/week", savings: "$980/mo", processes: ["QA reporting", "Shipping labels", "Delivery tracking"] }
    ]
  },
  "financial": {
    name: "Financial Services/Investment",
    examples: [
      { process: "Client reporting", timeSaved: "22 hrs/week", savings: "$1,540/mo", processes: ["Portfolio reports", "Statement generation", "Client communications"] },
      { process: "Compliance & documentation", timeSaved: "20 hrs/week", savings: "$1,400/mo", processes: ["Document management", "Audit preparation", "Regulatory reporting"] },
      { process: "Transaction processing", timeSaved: "18 hrs/week", savings: "$1,260/mo", processes: ["Trade processing", "Settlement management", "Payment tracking"] }
    ]
  }
};

// Export for use in HTML
if (typeof module !== 'undefined' && module.exports) {
  module.exports = industryData;
}
