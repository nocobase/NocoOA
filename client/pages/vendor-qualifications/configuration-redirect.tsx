import { Navigate } from 'react-router';
/** Legacy configuration URL now opens its owning process definition. */
export default function ConfigurationRedirect() {
  return (
    <Navigate
      replace
      to='/processManagement/definitions/oa.vendorQualification'
    />
  );
}
